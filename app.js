import { db } from "./firebase.js";
import {
    collection,
    addDoc,
    getDocs,
    query,
    where,
    updateDoc,
    doc,
    orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

let currentMeetingDocId  = null;
let currentMeetingLabel  = null;
let currentMeetingStart  = null; // timestamp — used for early-leave 30-min window

let pendingCheckoutSessionId = null;
let pendingCheckoutUserId    = null;

let isProcessingScan = false;
let scanTimeout      = null;

// ===================== UI HELPERS =====================
function showMessage(msg, type = "info") {
    const el = document.getElementById("message");
    el.innerText = msg;
    const colors = { error: "var(--red)", success: "var(--green)", warn: "var(--orange)", info: "var(--cyan)" };
    el.style.borderLeftColor = colors[type] || colors.info;
    el.style.color           = colors[type] || colors.info;
}

function setMeetingDot(active) {
    const dot = document.getElementById("meetingDot");
    dot.classList.toggle("active", active);
}

function updateLiveBox(html) {
    document.getElementById("liveBox").innerHTML =
        `<div style="color:var(--text2);font-size:0.85rem;">${html}</div>`;
}

// ===================== MEETING =====================
document.getElementById("startMeetingBtn").onclick = async () => {
    if (currentMeetingDocId) { showMessage("Meeting already active", "warn"); return; }

    const today         = new Date().toISOString().split("T")[0];
    const snapshot      = await getDocs(collection(db, "meetings"));
    const meetingNumber = snapshot.size + 1;
    const meetingLabel  = `Meeting ${meetingNumber} (${today})`;
    const startTime     = Date.now();

    const ref = await addDoc(collection(db, "meetings"), {
        startTime,
        endTime: null,
        active: true,
        meetingNumber,
        meetingLabel,
        date: today
    });

    currentMeetingDocId = ref.id;
    currentMeetingLabel = meetingLabel;
    currentMeetingStart = startTime;

    document.getElementById("meetingStatus").innerText = meetingLabel;
    setMeetingDot(true);
    showMessage("Started " + meetingLabel, "success");

    // Schedule auto-end at midnight (or 8 PM if past midnight check)
    scheduleMidnightAutoEnd();
};

document.getElementById("endMeetingBtn").onclick = async () => {
    if (!currentMeetingDocId) { showMessage("No active meeting", "error"); return; }
    await endMeeting(Date.now());
};

// Shared end-meeting logic — also used by auto-end
// autoCheckoutTime: if set, sign out all still-active sessions at this timestamp
async function endMeeting(endTime, autoCheckoutTime = null) {
    const meetId = currentMeetingDocId;

    await updateDoc(doc(db, "meetings", meetId), {
        endTime,
        active: false
    });

    // Auto sign out everyone still checked in.
    // Query on status only (no composite index needed), filter meetingId client-side.
    const allActiveSessions = await getDocs(
        query(collection(db, "sessions"), where("status", "==", "active"))
    );
    const openSessions = { docs: allActiveSessions.docs.filter(d => d.data().meetingId === meetId) };

    const checkoutTs = autoCheckoutTime || endTime;

    for (const d of openSessions.docs) {
        await updateDoc(doc(db, "sessions", d.id), {
            checkOutTime: checkoutTs,
            status: "completed",
            autoSignedOut: true,   // flag for directory display
            note: "Auto-signed out when meeting ended"
        });
    }

    currentMeetingDocId = null;
    currentMeetingLabel = null;
    currentMeetingStart = null;

    document.getElementById("meetingStatus").innerText = "No active meeting";
    setMeetingDot(false);
    showMessage("Meeting ended — all active sessions closed", "success");
}

// ===================== AUTO MIDNIGHT END =====================
let midnightTimer = null;

function scheduleMidnightAutoEnd() {
    clearTimeout(midnightTimer);
    if (!currentMeetingDocId) return;

    const now       = new Date();
    // Midnight tonight
    const midnight  = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const msToMidnight = midnight.getTime() - Date.now();

    midnightTimer = setTimeout(async () => {
        if (!currentMeetingDocId) return;
        // Cap checkout time at 8 PM of the meeting's start day
        const meetingDate = new Date(currentMeetingStart);
        const eightPm     = new Date(meetingDate);
        eightPm.setHours(20, 0, 0, 0);
        // If 8 PM is in the past relative to start, use start + a bit; else use 8 PM
        const autoCheckout = eightPm.getTime() > currentMeetingStart
            ? eightPm.getTime()
            : currentMeetingStart + 3 * 60 * 60 * 1000; // fallback: start + 3h
        await endMeeting(midnight.getTime(), autoCheckout);
    }, msToMidnight);
}

// ===================== SCAN DETECTION =====================
const scanInput = document.getElementById("scanInput");
const modeHint  = document.getElementById("scanModeHint");
const SCAN_SPEED_THRESHOLD = 50;
let keystrokeTimes = [];

function updateModeHint(mode) {
    if (!modeHint) return;
    if (mode === "scan")  { modeHint.textContent = "⚡ Scanner detected — auto-submitting"; modeHint.style.color = "var(--cyan)"; }
    else if (mode === "type") { modeHint.textContent = "⌨ Manual entry — press Enter to submit"; modeHint.style.color = "var(--text2)"; }
    else { modeHint.textContent = "Scan card or type school ID"; modeHint.style.color = "var(--text3)"; }
}

scanInput.addEventListener("keydown", (e) => {
    keystrokeTimes.push(Date.now());
    if (keystrokeTimes.length > 6) keystrokeTimes.shift();
    if (e.key === "Enter") { clearTimeout(scanTimeout); submitId(); }
});

scanInput.addEventListener("input", () => {
    clearTimeout(scanTimeout);
    let avgGap = Infinity;
    if (keystrokeTimes.length >= 2) {
        const gaps = [];
        for (let i = 1; i < keystrokeTimes.length; i++) gaps.push(keystrokeTimes[i] - keystrokeTimes[i-1]);
        avgGap = gaps.reduce((a,b) => a+b, 0) / gaps.length;
    }
    if (avgGap < SCAN_SPEED_THRESHOLD) {
        updateModeHint("scan");
        scanTimeout = setTimeout(() => submitId(), 120);
    } else {
        updateModeHint("type");
    }
});

async function submitId() {
    const id = scanInput.value.trim();
    scanInput.value = "";
    scanInput.focus();
    keystrokeTimes = [];
    updateModeHint("unknown");
    if (!id) return;
    if (!currentMeetingDocId) { showMessage("No active meeting — start one first", "error"); return; }
    await handleScan(id);
}

// ===================== FIND USER =====================
async function findUser(id) {
    const snap = await getDocs(collection(db, "users"));
    let user = null;
    const nid = id.trim().toString();
    snap.forEach(d => {
        const data = d.data();
        if ((data.cardId   || "").toString().trim() === nid ||
            (data.schoolId || "").toString().trim() === nid ||
            (data.identifiers || []).some(i => (i.value || "").toString().trim() === nid)) {
            user = { firestoreId: d.id, ...data };
        }
    });
    return user;
}

// ===================== SCAN LOGIC =====================
async function handleScan(id) {
    if (isProcessingScan) return;
    isProcessingScan = true;
    try {
        const user = await findUser(id);
        if (!user) { showMessage(`No student found for ID: ${id}`, "error"); updateLiveBox(`❌ Unknown ID: ${id}`); return; }

        // If there's a pending checkout, complete it if same user
        if (pendingCheckoutSessionId) {
            if (pendingCheckoutUserId === user.firestoreId) {
                await completeNormalCheckout(pendingCheckoutSessionId, user);
            } else {
                showMessage("Finish current checkout first", "warn");
            }
            return;
        }

        // Look for open session this meeting.
        // Query only on userId to avoid requiring a composite index —
        // then filter meetingId client-side. This is safe because one
        // user will never have more than a handful of sessions total.
        const snap = await getDocs(query(
            collection(db, "sessions"),
            where("userId", "==", user.firestoreId)
        ));
        let activeSession = null;
        snap.forEach(d => {
            const s = d.data();
            if (s.meetingId === currentMeetingDocId && !s.checkOutTime) {
                activeSession = { id: d.id, ...s };
            }
        });

        if (!activeSession) {
            await checkIn(user);
        } else {
            startCheckoutFlow(activeSession.id, user, activeSession.checkInTime);
        }
    } finally {
        isProcessingScan = false;
    }
}

// ===================== CHECK IN =====================
async function checkIn(user) {
    const displayName = user.name || user.firestoreId;
    const displayId   = user.schoolId || user.cardId || user.identifiers?.[0]?.value || user.firestoreId;

    await addDoc(collection(db, "sessions"), {
        userId:       user.firestoreId,
        displayId,
        displayName:  user.name || "",
        meetingId:    currentMeetingDocId,
        meetingLabel: currentMeetingLabel,
        checkInTime:  Date.now(),
        checkOutTime: null,
        earlyLeave:   false,
        earlyLeaveReason: null,
        autoSignedOut: false,
        status: "active"
    });

    showMessage(`✓ Checked in: ${displayName}`, "success");
    updateLiveBox(`🟢 <b>${displayName}</b> checked in<br><span style="color:var(--text3)">${currentMeetingLabel}</span>`);
}

// ===================== CHECKOUT FLOW =====================
function startCheckoutFlow(sessionId, user, checkInTime) {
    const name = user.name || user.firestoreId;
    const meetingStartTs = currentMeetingStart || checkInTime;
    const minsSinceMeetingStart = (Date.now() - meetingStartTs) / 60000;

    if (minsSinceMeetingStart <= 30) {
        // Within first 30 min — emergency leave modal required
        pendingCheckoutSessionId = sessionId;
        pendingCheckoutUserId    = user.firestoreId;
        showMessage(`Early leave? Select a reason below.`, "warn");
        updateLiveBox(`🔄 Early checkout: <b>${name}</b>`);
        document.getElementById("emergencyBox").classList.remove("hidden");
    } else {
        // Past 30 min — silent normal checkout, no modal
        completeNormalCheckout(sessionId, user);
    }
}

async function completeNormalCheckout(sessionId, user) {
    await updateDoc(doc(db, "sessions", sessionId), {
        checkOutTime: Date.now(),
        earlyLeave:   false,
        status:       "completed"
    });
    pendingCheckoutSessionId = null;
    pendingCheckoutUserId    = null;
    const name = user.name || user.firestoreId;
    showMessage(`✓ Checked out: ${name}`, "success");
    updateLiveBox(`⚫ <b>${name}</b> checked out`);
}

// ===================== EMERGENCY LEAVE =====================
document.getElementById("confirmEarlyLeaveBtn").onclick = async () => {
    const reason = document.getElementById("leaveReason").value;
    const other  = document.getElementById("otherReason").value;
    if (!pendingCheckoutSessionId) return;
    if (!reason) { showMessage("Select a reason first", "error"); return; }

    const finalReason = reason === "Other" ? (other || "Other") : reason;

    await updateDoc(doc(db, "sessions", pendingCheckoutSessionId), {
        checkOutTime:     Date.now(),
        earlyLeave:       true,
        earlyLeaveReason: finalReason,
        hoursVoided:      false,   // set to true if admin rejects
        status:           "pending_admin_review"
    });

    pendingCheckoutSessionId = null;
    pendingCheckoutUserId    = null;
    document.getElementById("emergencyBox").classList.add("hidden");
    document.getElementById("leaveReason").value = "";
    document.getElementById("otherReason").value = "";
    showMessage("Emergency leave submitted — pending admin review", "warn");
    updateLiveBox(`🚨 Emergency leave submitted`);
};

document.getElementById("cancelEarlyLeaveBtn").onclick = () => {
    pendingCheckoutSessionId = null;
    pendingCheckoutUserId    = null;
    document.getElementById("emergencyBox").classList.add("hidden");
    showMessage("Checkout cancelled");
};

// ===================== RESTORE MEETING =====================
async function restoreActiveMeeting() {
    const snap = await getDocs(collection(db, "meetings"));
    snap.forEach(d => {
        const data = d.data();
        if (data.active) {
            currentMeetingDocId = d.id;
            currentMeetingLabel = data.meetingLabel;
            currentMeetingStart = data.startTime;
            document.getElementById("meetingStatus").innerText = data.meetingLabel;
            setMeetingDot(true);
            scheduleMidnightAutoEnd();
        }
    });
}

restoreActiveMeeting();
window.addEventListener("load", () => document.getElementById("scanInput").focus());