import { db } from "./firebase.js";
import {
    collection,
    addDoc,
    getDocs,
    query,
    where,
    updateDoc,
    doc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

let currentMeetingDocId = null;
let currentMeetingLabel = null;

let pendingCheckoutSessionId = null;
let pendingCheckoutUserId = null;

let isProcessingScan = false;
let scanTimeout = null;

function showMessage(msg, type = "info") {
    const el = document.getElementById("message");
    el.innerText = msg;
    el.style.borderLeftColor = type === "error" ? "var(--red)" :
                               type === "success" ? "var(--green)" :
                               type === "warn" ? "var(--orange)" :
                               "var(--cyan)";
    el.style.color = type === "error" ? "var(--red)" :
                     type === "success" ? "var(--green)" :
                     type === "warn" ? "var(--orange)" :
                     "var(--cyan)";
}

function setMeetingDot(active) {
    const dot = document.getElementById("meetingDot");
    if (active) dot.classList.add("active");
    else dot.classList.remove("active");
}

//  MEETING 
document.getElementById("startMeetingBtn").onclick = async () => {
    if (currentMeetingDocId) {
        showMessage("Meeting already active", "warn");
        return;
    }

    const today = new Date().toISOString().split("T")[0];
    const snapshot = await getDocs(collection(db, "meetings"));
    const meetingNumber = snapshot.size + 1;
    const meetingLabel = `Meeting ${meetingNumber} (${today})`;

    const ref = await addDoc(collection(db, "meetings"), {
        startTime: Date.now(),
        endTime: null,
        active: true,
        meetingNumber,
        meetingLabel,
        date: today
    });

    currentMeetingDocId = ref.id;
    currentMeetingLabel = meetingLabel;

    document.getElementById("meetingStatus").innerText = meetingLabel;
    setMeetingDot(true);
    showMessage("Started " + meetingLabel, "success");
};

document.getElementById("endMeetingBtn").onclick = async () => {
    if (!currentMeetingDocId) {
        showMessage("No active meeting", "error");
        return;
    }

    await updateDoc(doc(db, "meetings", currentMeetingDocId), {
        endTime: Date.now(),
        active: false
    });

    currentMeetingDocId = null;
    currentMeetingLabel = null;

    document.getElementById("meetingStatus").innerText = "No active meeting";
    setMeetingDot(false);
    showMessage("Meeting ended");
};

//  SCANNING 
const scanInput = document.getElementById("scanInput");

const SCAN_SPEED_THRESHOLD = 50; 
let keystrokeTimes = [];
let inputMode = "unknown"; // "scan" | "type"

// Show the current mode as a hint below the input
const modeHint = document.getElementById("scanModeHint");

function updateModeHint(mode) {
    if (!modeHint) return;
    if (mode === "scan") {
        modeHint.textContent = "⚡ Scanner detected — auto-submitting";
        modeHint.style.color = "var(--cyan)";
    } else if (mode === "type") {
        modeHint.textContent = "⌨ Manual entry — press Enter to submit";
        modeHint.style.color = "var(--text2)";
    } else {
        modeHint.textContent = "Scan or type student ID";
        modeHint.style.color = "var(--text3)";
    }
}

scanInput.addEventListener("keydown", () => {
    keystrokeTimes.push(Date.now());
    // Only keep last 5 keystrokes for averaging
    if (keystrokeTimes.length > 6) keystrokeTimes.shift();
});

scanInput.addEventListener("input", () => {
    clearTimeout(scanTimeout);

    // Calculate average gap between recent keystrokes
    let avgGap = Infinity;
    if (keystrokeTimes.length >= 2) {
        const gaps = [];
        for (let i = 1; i < keystrokeTimes.length; i++) {
            gaps.push(keystrokeTimes[i] - keystrokeTimes[i - 1]);
        }
        avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    }

    if (avgGap < SCAN_SPEED_THRESHOLD) {
        inputMode = "scan";
        updateModeHint("scan");
        // Auto-submit shortly after scanner finishes sending characters
        scanTimeout = setTimeout(() => submitId(), 120);
    } else {
        inputMode = "type";
        updateModeHint("type");
        // Don't auto-submit for typing — wait for Enter
    }
});

// Enter key always submits
scanInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        clearTimeout(scanTimeout);
        submitId();
    }
});

async function submitId() {
    const id = scanInput.value.trim();
    scanInput.value = "";
    scanInput.focus();
    keystrokeTimes = [];
    inputMode = "unknown";
    updateModeHint("unknown");

    if (!id) return;

    if (!currentMeetingDocId) {
        showMessage("No active meeting — start one first", "error");
        return;
    }

    await handleScan(id);
}

//  FIND USER 
async function findUser(id) {
    const snap = await getDocs(collection(db, "users"));
    let user = null;
    const normalizedId = id.trim().toString();

    snap.forEach(docu => {
        const data = docu.data();

        // Match against cardId or schoolId (new schema)
        const matchCard   = (data.cardId   || "").toString().trim() === normalizedId;
        const matchSchool = (data.schoolId || "").toString().trim() === normalizedId;

        // Backward compat with old identifiers[] array
        const identifiers = data.identifiers || [];
        const matchLegacy = identifiers.some(i =>
            (i.value || "").toString().trim() === normalizedId
        );

        if (matchCard || matchSchool || matchLegacy) {
            user = { firestoreId: docu.id, ...data };
        }
    });

    return user;
}

//  SCAN LOGIC 
async function handleScan(id) {
    if (isProcessingScan) return;
    isProcessingScan = true;

    try {
        const user = await findUser(id);

        if (!user) {
            showMessage(`No student found for ID: ${id}`, "error");
            updateLiveBox(`❌ Unknown ID: ${id}`);
            return;
        }

        if (pendingCheckoutSessionId) {
            if (pendingCheckoutUserId === user.firestoreId) {
                await completeNormalCheckout(pendingCheckoutSessionId, user);
            } else {
                showMessage("Finish current checkout first", "warn");
            }
            return;
        }

        const q = query(
            collection(db, "sessions"),
            where("userId", "==", user.firestoreId),
            where("meetingId", "==", currentMeetingDocId)
        );

        const snap = await getDocs(q);
        let activeSession = null;

        snap.forEach(d => {
            const s = d.data();
            if (!s.checkOutTime) activeSession = { id: d.id, ...s };
        });

        if (!activeSession) {
            await checkIn(user);
        } else {
            startCheckoutFlow(activeSession.id, user);
        }

    } finally {
        isProcessingScan = false;
    }
}

function updateLiveBox(html) {
    const box = document.getElementById("liveBox");
    box.innerHTML = `<div style="color:var(--text2);font-size:0.85rem;">${html}</div>`;
}

//  CHECK IN 
async function checkIn(user) {
    const displayName = user.name || user.cardId || user.schoolId || user.firestoreId;
    // Prefer schoolId as the human-readable display ID, fall back to cardId
    const displayId = user.schoolId || user.cardId
        || user.identifiers?.[0]?.value || user.firestoreId;

    await addDoc(collection(db, "sessions"), {
        userId: user.firestoreId,
        displayId,
        displayName: user.name || "",
        meetingId: currentMeetingDocId,
        meetingLabel: currentMeetingLabel,
        checkInTime: Date.now(),
        checkOutTime: null,
        earlyLeave: false,
        earlyLeaveReason: null,
        status: "active"
    });

    showMessage(`✓ Checked in: ${displayName}`, "success");
    updateLiveBox(`🟢 <b>${displayName}</b> checked in<br><span style="color:var(--text3)">${currentMeetingLabel}</span>`);
}

//  CHECKOUT FLOW 
function startCheckoutFlow(sessionId, user) {
    pendingCheckoutSessionId = sessionId;
    pendingCheckoutUserId = user.firestoreId;

    const name = user.name || user.identifiers?.[0]?.value || user.firestoreId;
    showMessage(`Scan again to checkout: ${name}`, "warn");
    updateLiveBox(`🔄 Checking out: <b>${name}</b>`);
    document.getElementById("emergencyBox").classList.remove("hidden");
}

async function completeNormalCheckout(sessionId, user) {
    await updateDoc(doc(db, "sessions", sessionId), {
        checkOutTime: Date.now(),
        earlyLeave: false,
        status: "completed"
    });

    pendingCheckoutSessionId = null;
    pendingCheckoutUserId = null;

    const name = user.name || user.identifiers?.[0]?.value || user.firestoreId;
    document.getElementById("emergencyBox").classList.add("hidden");
    showMessage(`✓ Checked out: ${name}`, "success");
    updateLiveBox(`⚫ <b>${name}</b> checked out`);
}

//  EMERGENCY LEAVE 
document.getElementById("confirmEarlyLeaveBtn").onclick = async () => {
    const reason = document.getElementById("leaveReason").value;
    const other = document.getElementById("otherReason").value;

    if (!pendingCheckoutSessionId) return;
    if (!reason) { showMessage("Select a reason first", "error"); return; }

    const finalReason = reason === "Other" ? (other || "Other") : reason;

    await updateDoc(doc(db, "sessions", pendingCheckoutSessionId), {
        checkOutTime: Date.now(),
        earlyLeave: true,
        earlyLeaveReason: finalReason,
        status: "pending_admin_review"
    });

    pendingCheckoutSessionId = null;
    pendingCheckoutUserId = null;

    document.getElementById("emergencyBox").classList.add("hidden");
    document.getElementById("leaveReason").value = "";
    document.getElementById("otherReason").value = "";

    showMessage("Emergency leave submitted — pending admin review", "warn");
    updateLiveBox(`🚨 Emergency leave submitted`);
};

document.getElementById("cancelEarlyLeaveBtn").onclick = () => {
    pendingCheckoutSessionId = null;
    pendingCheckoutUserId = null;
    document.getElementById("emergencyBox").classList.add("hidden");
    showMessage("Checkout cancelled");
};

//  RESTORE MEETING 
async function restoreActiveMeeting() {
    const snap = await getDocs(collection(db, "meetings"));
    snap.forEach(d => {
        const data = d.data();
        if (data.active) {
            currentMeetingDocId = d.id;
            currentMeetingLabel = data.meetingLabel;
            document.getElementById("meetingStatus").innerText = data.meetingLabel;
            setMeetingDot(true);
        }
    });
}

restoreActiveMeeting();

// Auto-focus scanner
window.addEventListener("load", () => {
    document.getElementById("scanInput").focus();
});