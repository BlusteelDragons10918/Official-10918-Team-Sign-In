import { db, auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
    collection,
    addDoc,
    getDocs,
    query,
    where,
    updateDoc,
    doc,
    orderBy,
    writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Wait for the existing admin login to be restored when the scanner page opens.
const adminAuthReady = new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, () => {
        unsubscribe();
        resolve();
    }, reject);
});
// The Start handler reports initialization failures without blocking public pages.
adminAuthReady.catch(() => {});

let currentMeetingDocId  = null;
let currentMeetingLabel  = null;
let currentMeetingStart  = null; // timestamp — used for early-leave 30-min window

let pendingCheckoutSessionId = null;
let pendingCheckoutUserId    = null;

let isChangingMeeting = false;
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

// ===================== MEETING ====================
function localMeetingDate(timestamp) {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function useMeeting(id, meeting) {
    currentMeetingDocId = id;
    currentMeetingLabel = meeting.meetingLabel;
    currentMeetingStart = meeting.startTime;
    document.getElementById("meetingStatus").innerText = meeting.meetingLabel;
    setMeetingDot(true);
    scheduleMidnightAutoEnd();
}

document.getElementById("startMeetingBtn").onclick = async () => {
    try {
        await adminAuthReady;
    } catch {
        showMessage("Unable to check admin sign-in. Please refresh and try again.", "error");
        return;
    }
    if (!auth.currentUser) {
        showMessage("Please sign in as admin. Use the Admin link, then return here to start a meeting.", "warn");
        return;
    }
    if (isChangingMeeting) return;
    if (currentMeetingDocId) { showMessage("Meeting already active", "warn"); return; }

    isChangingMeeting = true;
    try {
        const today = localMeetingDate(Date.now());
        const snapshot = await getDocs(collection(db, "meetings"));
        const meetings = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        const active = meetings.find(m => m.active);
        if (active) {
            useMeeting(active.id, active);
            showMessage("Meeting already active — " + active.meetingLabel, "warn");
            return;
        }

        // Use the original start timestamp, including for legacy UTC date labels.
        const previous = meetings
            .filter(m => localMeetingDate(m.startTime) === today)
            .sort((a, b) => b.startTime - a.startTime)[0];
        if (previous) {
            const sessions = await getDocs(query(collection(db, "sessions"), where("meetingId", "==", previous.id)));
            const resume = sessions.docs.filter(d => {
                const session = d.data();
                return session.autoSignedOut && session.status === "completed" &&
                    (session.autoSignOutMeetingEnd ?? session.checkOutTime) === previous.endTime;
            });
            // Keep the meeting and its sessions consistent if a write fails.
            if (resume.length > 499) throw new Error("Too many sessions to reopen together. Contact an administrator.");
            const batch = writeBatch(db);
            batch.update(doc(db, "meetings", previous.id), { active: true, endTime: null });
            resume.forEach(d => batch.update(doc(db, "sessions", d.id), {
                checkOutTime: null,
                status: "active",
                autoSignedOut: false,
                hoursVoided: false,
                hoursRestored: false,
                autoSignOutMeetingEnd: null,
                note: d.data().noteBeforeAutoSignOut || ""
            }));
            await batch.commit();
            useMeeting(previous.id, previous);
            showMessage(`Reopened ${previous.meetingLabel} — ${resume.length} student(s) checked back in. Accidental auto sign-outs and removed hours were undone.`, "success");
            return;
        }

        const meetingNumber = Math.max(snapshot.size, ...meetings.map(m => Number(m.meetingNumber) || 0)) + 1;
        const meeting = {
            startTime: Date.now(), endTime: null, active: true,
            meetingNumber, meetingLabel: `Meeting ${meetingNumber} (${today})`, date: today
        };
        const ref = await addDoc(collection(db, "meetings"), meeting);
        useMeeting(ref.id, meeting);
        showMessage("Started " + meeting.meetingLabel, "success");
    } catch (err) {
        showMessage("Could not start meeting: " + err.message, "error");
    } finally {
        isChangingMeeting = false;
    }
};

document.getElementById("endMeetingBtn").onclick = async () => {
    if (!currentMeetingDocId) { showMessage("No active meeting", "error"); return; }
    await endMeeting(Date.now());
};

// End and reopen write the meeting and affected sessions atomically.
async function endMeeting(endTime, autoCheckoutTime = null) {
    if (isChangingMeeting || !currentMeetingDocId) return;
    isChangingMeeting = true;
    try {
        const meetId = currentMeetingDocId;
        const allActiveSessions = await getDocs(
            query(collection(db, "sessions"), where("status", "==", "active"))
        );
        const openSessions = allActiveSessions.docs.filter(d => d.data().meetingId === meetId);
        if (openSessions.length > 499) throw new Error("Too many sessions to close together. Contact an administrator.");
        const batch = writeBatch(db);
        batch.update(doc(db, "meetings", meetId), { endTime, active: false });
        const checkoutTs = autoCheckoutTime || endTime;
        openSessions.forEach(d => batch.update(doc(db, "sessions", d.id), {
            checkOutTime: Math.max(checkoutTs, d.data().checkInTime),
            status: "completed",
            autoSignedOut: true,
            hoursVoided: true,
            hoursRestored: false,
            autoSignOutMeetingEnd: endTime,
            noteBeforeAutoSignOut: d.data().note || "",
            note: "Auto-signed out when meeting ended — session hours removed from total"
        }));
        await batch.commit();
        currentMeetingDocId = null;
        currentMeetingLabel = null;
        currentMeetingStart = null;
        pendingCheckoutSessionId = null;
        pendingCheckoutUserId = null;
        document.getElementById("emergencyBox").classList.add("hidden");
        clearTimeout(midnightTimer);
        document.getElementById("meetingStatus").innerText = "No active meeting";
        setMeetingDot(false);
        showMessage(openSessions.length
            ? `Meeting ended — ${openSessions.length} student(s) auto-signed out. Their session hours were removed from their totals.`
            : "Meeting ended — all students had signed out", "success");
    } catch (err) {
        showMessage("Could not end meeting: " + err.message, "error");
    } finally {
        isChangingMeeting = false;
    }
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
    if (isChangingMeeting) { showMessage("Meeting is updating — please scan again in a moment", "warn"); return; }
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