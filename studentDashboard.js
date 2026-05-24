import { db } from "./firebase.js";
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
    const user    = userDoc.exists() ? userDoc.data() : null;

    const name      = user?.name || "Unknown Student";
    const displayId = user?.schoolId || user?.cardId || user?.identifiers?.[0]?.value || userId;
    const initials  = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

    document.getElementById("profileName").innerText   = name;
    document.getElementById("profileId").innerText     = `School ID: ${displayId}`;
    document.getElementById("profileAvatar").innerText = initials;
    document.title = `${name} · Bluesteel Dragons`;

    // ── 2. Load ALL meetings ─────────────────────────────────────
    const meetingsSnap = await getDocs(
        query(collection(db, "meetings"), orderBy("startTime", "asc"))
    );
    const allMeetings = [];
    meetingsSnap.forEach(d => allMeetings.push({ id: d.id, ...d.data() }));

    // ── 3. Load ALL sessions for this student ────────────────────
    const sessionsSnap = await getDocs(
        query(collection(db, "sessions"), where("userId", "==", userId))
    );

    // Group ALL sessions by meetingId (there may be duplicates from the old bug).
    // Per meeting, pick the "best" session: prefer completed/approved over active,
    // and among same status pick the one with the longest duration.
    const sessionByMeeting = {};
    sessionsSnap.forEach(d => {
        const s  = { id: d.id, ...d.data() };
        const mid = s.meetingId;
        if (!sessionByMeeting[mid]) {
            sessionByMeeting[mid] = s;
        } else {
            const existing = sessionByMeeting[mid];
            // Prefer: has checkOutTime > no checkOutTime
            if (!existing.checkOutTime && s.checkOutTime) {
                sessionByMeeting[mid] = s;
            } else if (existing.checkOutTime && s.checkOutTime) {
                // Both checked out — keep longer one
                const existDur = existing.checkOutTime - existing.checkInTime;
                const newDur   = s.checkOutTime - s.checkInTime;
                if (newDur > existDur) sessionByMeeting[mid] = s;
            }
        }
    });

    // ── 4. Compute stats ─────────────────────────────────────────
    let totalMinutes  = 0;
    let attendedCount = 0;
    let missedCount   = 0;

    allMeetings.forEach(meeting => {
        const session = sessionByMeeting[meeting.id];
        if (session) {
            attendedCount++;
            // Only count hours if not voided (rejected emergency leave)
            if (session.checkInTime && session.checkOutTime && !session.hoursVoided) {
                totalMinutes += (session.checkOutTime - session.checkInTime) / 60000;
            }
        } else {
            if (!meeting.active) missedCount++;
        }
    });

    document.getElementById("totalHours").innerText     = (totalMinutes / 60).toFixed(1);
    document.getElementById("totalSessions").innerText  = attendedCount;
    document.getElementById("missedMeetings").innerText = missedCount;

    // ── 5. Render every meeting row (newest first) ───────────────
    const sessionList = document.getElementById("sessionList");
    sessionList.innerHTML = "";

    if (allMeetings.length === 0) {
        sessionList.innerHTML = '<div class="empty">No meetings have been held yet</div>';
        return;
    }

    [...allMeetings].reverse().forEach(meeting => {
        const session  = sessionByMeeting[meeting.id];
        const row      = document.createElement("div");

        if (!session) {
            // ── NO SESSION: Missed or In Progress ───────────────
            row.className = `meeting-row ${meeting.active ? "row-inprogress" : "row-missed"}`;
            row.innerHTML = `
                <div class="mrow-icon ${meeting.active ? "icon-inprogress" : "icon-missed"}">
                    ${meeting.active ? "…" : "✕"}
                </div>
                <div class="mrow-body">
                    <div class="mrow-title">${meeting.meetingLabel || "Meeting"}</div>
                    <div class="mrow-meta">${formatDate(meeting.startTime)}</div>
                </div>
                <div class="mrow-right">
                    ${meeting.active
                        ? '<span class="row-tag tag-inprogress">In Progress</span>'
                        : '<span class="row-tag tag-missed">Missed</span>'
                    }
                </div>`;

        } else {
            // ── HAS SESSION: determine color tier ───────────────
            const inTime  = session.checkInTime
                ? new Date(session.checkInTime).toLocaleTimeString("en-US",  { hour: "2-digit", minute: "2-digit" })
                : "—";
            const outTime = session.checkOutTime
                ? new Date(session.checkOutTime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
                : "—";
            const durationHrs = (session.checkInTime && session.checkOutTime)
                ? ((session.checkOutTime - session.checkInTime) / 3600000).toFixed(2) + " hrs"
                : "Active";

            // Decide row color + label
            let rowClass, iconClass, iconChar, tagClass, tagText, noteHtml = "";

            if (session.status === "rejected" || session.hoursVoided) {
                // ── RED: rejected emergency leave (hours don't count)
                rowClass  = "row-rejected";
                iconClass = "icon-rejected";
                iconChar  = "✕";
                tagClass  = "tag-rejected";
                tagText   = "Rejected Leave";
                noteHtml  = `<div class="mrow-note note-red">Hours not counted — leave rejected</div>`;

            } else if (session.autoSignedOut) {
                // ── YELLOW: auto-signed out by system
                rowClass  = "row-auto";
                iconClass = "icon-auto";
                iconChar  = "⚡";
                tagClass  = "tag-auto";
                tagText   = "Auto Sign-Out";
                noteHtml  = `<div class="mrow-note note-yellow">Auto-signed out when meeting ended</div>`;

            } else if (session.status === "pending_admin_review") {
                // ── ORANGE: emergency leave pending
                rowClass  = "row-pending";
                iconClass = "icon-pending";
                iconChar  = "?";
                tagClass  = "tag-pending";
                tagText   = "Pending Review";
                noteHtml  = `<div class="mrow-note note-orange">Emergency leave: ${session.earlyLeaveReason || "no reason"}</div>`;

            } else if (session.status === "approved") {
                // ── BLUE: approved emergency leave
                rowClass  = "row-approved";
                iconClass = "icon-approved";
                iconChar  = "✓";
                tagClass  = "tag-approved";
                tagText   = "Approved Leave";
                noteHtml  = `<div class="mrow-note note-blue">Early leave approved: ${session.earlyLeaveReason || ""}</div>`;

            } else if (!session.checkOutTime) {
                // ── CYAN: still active (meeting in progress)
                rowClass  = "row-active";
                iconClass = "icon-active";
                iconChar  = "●";
                tagClass  = "tag-active-row";
                tagText   = "Active";

            } else {
                // ── GREEN: normal attended + signed out correctly
                rowClass  = "row-attended";
                iconClass = "icon-attended";
                iconChar  = "✓";
                tagClass  = "tag-attended";
                tagText   = "Attended";
            }

            row.className = `meeting-row ${rowClass}`;
            row.innerHTML = `
                <div class="mrow-icon ${iconClass}">${iconChar}</div>
                <div class="mrow-body">
                    <div class="mrow-title">${meeting.meetingLabel || "Meeting"}</div>
                    <div class="mrow-meta">${formatDate(meeting.startTime)} · In ${inTime} · Out ${outTime}</div>
                    ${noteHtml}
                </div>
                <div class="mrow-right">
                    <span class="mrow-duration">${durationHrs}</span>
                    <span class="row-tag ${tagClass}">${tagText}</span>
                </div>`;
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