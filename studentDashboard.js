import { app, db } from "/Official-10918-Team-Sign-In/firebase.js";
import {
    collection,
    getDocs,
    query,
    where,
    doc,
    getDoc,
    orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const urlParams = new URLSearchParams(window.location.search);
const userId = urlParams.get("id");

if (!userId) {
    document.body.innerHTML = '<div class="page-wrap"><h1 style="color:var(--red)">No student selected</h1></div>';
}

async function loadStudent() {
    // ── 1. Load student profile ──────────────────────────────────
    const userDoc = await getDoc(doc(db, "users", userId));
    const user = userDoc.exists() ? userDoc.data() : null;

    const name      = user?.name || "Unknown Student";
    const displayId = user?.schoolId || user?.cardId || user?.identifiers?.[0]?.value || userId;
    const initials  = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

    document.getElementById("profileName").innerText  = name;
    document.getElementById("profileId").innerText    = `School ID: ${displayId}`;
    document.getElementById("profileAvatar").innerText = initials;
    document.title = `${name} · Bluesteel Dragons`;

    // ── 2. Load ALL meetings (sorted oldest → newest) ───────────
    const meetingsSnap = await getDocs(
        query(collection(db, "meetings"), orderBy("startTime", "asc"))
    );
    const allMeetings = [];
    meetingsSnap.forEach(d => {
        allMeetings.push({ id: d.id, ...d.data() });
    });

    // ── 3. Load this student's sessions ─────────────────────────
    const sessionsSnap = await getDocs(
        query(collection(db, "sessions"), where("userId", "==", userId))
    );

    // Map meetingId → session data
    const sessionByMeeting = {};
    sessionsSnap.forEach(d => {
        const s = d.data();
        sessionByMeeting[s.meetingId] = { id: d.id, ...s };
    });

    // ── 4. Compute totals ────────────────────────────────────────
    let totalMinutes = 0;
    let attendedCount = 0;
    let missedCount = 0;

    allMeetings.forEach(meeting => {
        const session = sessionByMeeting[meeting.id];
        if (session) {
            attendedCount++;
            if (session.checkInTime && session.checkOutTime) {
                totalMinutes += (session.checkOutTime - session.checkInTime) / 60000;
            }
        } else {
            // Only count as missed if the meeting has ended (not currently active)
            if (!meeting.active) missedCount++;
        }
    });

    document.getElementById("totalHours").innerText    = (totalMinutes / 60).toFixed(1);
    document.getElementById("totalSessions").innerText = attendedCount;
    document.getElementById("missedMeetings").innerText = missedCount;

    // ── 5. Render meeting list (newest first) ────────────────────
    const sessionList = document.getElementById("sessionList");
    sessionList.innerHTML = "";

    if (allMeetings.length === 0) {
        sessionList.innerHTML = '<div class="empty">No meetings have been held yet</div>';
        return;
    }

    // Reverse for newest-first display
    [...allMeetings].reverse().forEach(meeting => {
        const session = sessionByMeeting[meeting.id];
        const isActive = meeting.active;

        const row = document.createElement("div");

        if (!session) {
            // ── MISSED (or ongoing with no check-in) ──
            row.className = "meeting-row missed";
            row.innerHTML = `
                <div class="mrow-icon missed-icon">✕</div>
                <div class="mrow-body">
                    <div class="mrow-title">${meeting.meetingLabel || "Meeting"}</div>
                    <div class="mrow-meta">${formatDate(meeting.startTime)}</div>
                </div>
                <div class="mrow-right">
                    ${isActive
                        ? '<span class="tag active" style="font-size:0.65rem;">In Progress</span>'
                        : '<span class="missed-tag">Missed</span>'
                    }
                </div>
            `;
        } else {
            // ── ATTENDED ──
            const duration = session.checkInTime && session.checkOutTime
                ? ((session.checkOutTime - session.checkInTime) / 3600000).toFixed(2) + " hrs"
                : "Still active";

            const inTime  = session.checkInTime
                ? new Date(session.checkInTime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
                : "—";
            const outTime = session.checkOutTime
                ? new Date(session.checkOutTime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
                : "—";

            const statusTag = session.earlyLeave
                ? `<span class="tag emergency" style="font-size:0.65rem;">Early Leave${session.earlyLeaveReason ? ": " + session.earlyLeaveReason : ""}</span>`
                : session.status === "approved"
                ? '<span class="tag approved" style="font-size:0.65rem;">Approved</span>'
                : session.checkOutTime
                ? '<span class="tag done" style="font-size:0.65rem;">Attended</span>'
                : '<span class="tag active" style="font-size:0.65rem;">Active</span>';

            row.className = "meeting-row attended";
            row.innerHTML = `
                <div class="mrow-icon attended-icon">✓</div>
                <div class="mrow-body">
                    <div class="mrow-title">${meeting.meetingLabel || "Meeting"}</div>
                    <div class="mrow-meta">${formatDate(meeting.startTime)} · In ${inTime} · Out ${outTime}</div>
                </div>
                <div class="mrow-right">
                    <span class="mrow-duration">${duration}</span>
                    ${statusTag}
                </div>
            `;
        }

        sessionList.appendChild(row);
    });
}

function formatDate(ts) {
    if (!ts) return "Unknown date";
    return new Date(ts).toLocaleDateString("en-US", {
        weekday: "short", month: "short", day: "numeric", year: "numeric"
    });
}

loadStudent();