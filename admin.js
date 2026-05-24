import { db } from "./firebase.js";
import {
    collection, query, where, onSnapshot,
    updateDoc, getDocs, addDoc, doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { auth } from "./firebase.js";
import {
    signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// ============================================================
//  USER CACHE
// ============================================================
let userCache = {}; // firestoreId → { name, displayId, schoolId, cardId }

async function buildUserCache() {
    const snap = await getDocs(collection(db, "users"));
    snap.forEach(d => {
        const data = d.data();
        userCache[d.id] = {
            name:      data.name || "",
            schoolId:  data.schoolId || "",
            cardId:    data.cardId || "",
            displayId: data.schoolId || data.cardId || data.identifiers?.[0]?.value || d.id
        };
    });
}

function resolveDisplay(session) {
    const cached = userCache[session.userId] || {};
    return {
        name: session.displayName || cached.name || session.displayId || session.userId || "Unknown",
        id:   session.displayId   || cached.displayId || session.userId || ""
    };
}

// ============================================================
//  AUTH
// ============================================================
document.getElementById("loginBtn").onclick = async () => {
    const email = document.getElementById("adminEmail").value.trim();
    const pass  = document.getElementById("adminPassword").value;
    const err   = document.getElementById("loginError");
    err.innerText = "";
    try { await signInWithEmailAndPassword(auth, email, pass); }
    catch { err.innerText = "Invalid credentials. Try again."; }
};
document.getElementById("adminPassword").addEventListener("keydown", e => {
    if (e.key === "Enter") document.getElementById("loginBtn").click();
});

onAuthStateChanged(auth, async user => {
    if (user) {
        document.getElementById("adminLogin").classList.add("hidden");
        document.getElementById("dashboard").classList.remove("hidden");
        await buildUserCache();
        listenMeeting();
        listenLiveSessions();
        listenLeaveRequests();
        loadMeetingHistory();
        loadMissingCardIds();
        loadFlags();
    } else {
        document.getElementById("adminLogin").classList.remove("hidden");
        document.getElementById("dashboard").classList.add("hidden");
    }
});
window.logout = () => signOut(auth);

// ============================================================
//  MEETING STATUS BAR
// ============================================================
function listenMeeting() {
    onSnapshot(collection(db, "meetings"), snap => {
        let active = null;
        snap.forEach(d => { if (d.data().active) active = d.data(); });
        document.getElementById("activeMeeting").innerText =
            active ? active.meetingLabel : "No active meeting";
    });
}

// ============================================================
//  LIVE SESSIONS  (only currently signed-in people)
// ============================================================
function listenLiveSessions() {
    // Single-field query only — no composite index needed.
    // Sort client-side after receiving results.
    const q = query(
        collection(db, "sessions"),
        where("status", "==", "active")
    );

    onSnapshot(q, snap => {
        const container = document.getElementById("sessionList");
        container.innerHTML = "";
        document.getElementById("statPresent").innerText = snap.size;

        if (snap.empty) {
            container.innerHTML = '<div class="empty">Nobody currently signed in</div>';
            return;
        }

        // Sort newest check-in first client-side
        const docs = [...snap.docs].sort((a, b) => b.data().checkInTime - a.data().checkInTime);

        docs.forEach(d => {
            const s = d.data();
            const { name, id } = resolveDisplay(s);
            const elapsed = Math.round((Date.now() - s.checkInTime) / 60000);

            const el = document.createElement("div");
            el.className = "session-item";
            el.innerHTML = `
                <div class="flex-between">
                    <div>
                        <div class="session-name">${name}</div>
                        <div style="font-family:var(--font-mono);font-size:0.72rem;color:var(--text3);margin-top:2px;">ID: ${id}</div>
                    </div>
                    <span class="tag active">● Active</span>
                </div>
                <div class="session-meta">
                    <span>📋 ${s.meetingLabel || s.meetingId}</span>
                    <span>⏱ ${elapsed} min ago</span>
                </div>
                <div class="session-meta">
                    <span>In: ${new Date(s.checkInTime).toLocaleString()}</span>
                </div>
                <div style="margin-top:0.5rem;">
                    <button class="btn-end-session" onclick="endSessionNow('${d.id}','${name}')">End Session</button>
                </div>
            `;
            container.appendChild(el);
        });
    });
}

window.endSessionNow = async (sessionId, name) => {
    if (!confirm(`End session for ${name}?`)) return;
    await updateDoc(doc(db, "sessions", sessionId), {
        checkOutTime:  Date.now(),
        status:        "completed",
        earlyLeave:    false,
        autoSignedOut: false,
        note:          "Manually ended by admin"
    });
};

// ============================================================
//  LEAVE REQUESTS
// ============================================================
function listenLeaveRequests() {
    onSnapshot(
        query(collection(db, "sessions"), where("status", "==", "pending_admin_review")),
        snap => {
            const container = document.getElementById("leaveRequests");
            container.innerHTML = "";
            document.getElementById("statPending").innerText = snap.size;

            if (snap.empty) {
                container.innerHTML = '<div class="empty">No pending requests ✓</div>';
                return;
            }

            snap.forEach(d => {
                const s = d.data();
                const { name, id } = resolveDisplay(s);
                const card = document.createElement("div");
                card.className = "leave-item";
                card.innerHTML = `
                    <div class="flex-between">
                        <div>
                            <div class="session-name">${name}</div>
                            <div style="font-family:var(--font-mono);font-size:0.72rem;color:var(--text3);margin-top:2px;">ID: ${id}</div>
                        </div>
                        <span class="tag emergency">Pending</span>
                    </div>
                    <div class="session-meta">📋 ${s.meetingLabel || s.meetingId}</div>
                    <div class="leave-reason">Reason: <b>${s.earlyLeaveReason || "No reason given"}</b></div>
                    <div class="session-meta">
                        <span>In: ${new Date(s.checkInTime).toLocaleString()}</span>
                        <span>Out: ${new Date(s.checkOutTime).toLocaleString()}</span>
                    </div>
                    <div class="leave-actions">
                        <button class="btn-approve" onclick="approveLeave('${d.id}')">✓ Approve</button>
                        <button class="btn-reject"  onclick="rejectLeave('${d.id}')">✕ Reject</button>
                    </div>
                `;
                container.appendChild(card);
            });
        }
    );
}

// Approve: hours count normally
window.approveLeave = async id => {
    await updateDoc(doc(db, "sessions", id), {
        status:      "approved",
        hoursVoided: false
    });
    // Refresh flags in case patterns changed
    loadFlags();
};

// Reject: void the hours for this session
window.rejectLeave = async id => {
    await updateDoc(doc(db, "sessions", id), {
        status:      "rejected",
        hoursVoided: true   // ← hours are zeroed out in any hours calculation
    });
    loadFlags();
};

// ============================================================
//  MEETING HISTORY ACCORDION
// ============================================================
async function loadMeetingHistory() {
    const container = document.getElementById("meetingHistory");

    onSnapshot(
        collection(db, "meetings"),
        async snap => {
            container.innerHTML = "";
            if (snap.empty) { container.innerHTML = '<div class="empty">No meetings recorded</div>'; return; }

            const allSessionsSnap = await getDocs(collection(db, "sessions"));
            const sessionsByMeeting = {};
            allSessionsSnap.forEach(d => {
                const s = d.data();
                if (!sessionsByMeeting[s.meetingId]) sessionsByMeeting[s.meetingId] = [];
                sessionsByMeeting[s.meetingId].push({ id: d.id, ...s });
            });

            // Sort meetings newest-first client-side
            const meetingDocs = [...snap.docs].sort((a, b) => b.data().startTime - a.data().startTime);

            meetingDocs.forEach(d => {
                const meeting   = d.data();
                const mid       = d.id;
                const sessions  = sessionsByMeeting[mid] || [];

                // Meeting duration = endTime - startTime (not sum of attendees)
                const meetingDuration = meeting.endTime && meeting.startTime
                    ? ((meeting.endTime - meeting.startTime) / 3600000).toFixed(2) + " hrs"
                    : meeting.active ? "In progress" : "—";

                const statusDot = meeting.active
                    ? '<span class="tag active" style="font-size:0.65rem;">● Live</span>'
                    : '<span class="tag done"   style="font-size:0.65rem;">Ended</span>';

                const startDate = new Date(meeting.startTime).toLocaleDateString("en-US",
                    { weekday: "short", month: "short", day: "numeric" });
                const startTime = new Date(meeting.startTime).toLocaleTimeString("en-US",
                    { hour: "2-digit", minute: "2-digit" });

                const accordion = document.createElement("div");
                accordion.className = "accordion";
                accordion.innerHTML = `
                    <button class="accordion-header" onclick="toggleAccordion('${mid}')">
                        <div class="accordion-left">
                            <span class="accordion-title">${meeting.meetingLabel || "Meeting"}</span>
                            <span class="accordion-sub">${startDate} · ${startTime}</span>
                        </div>
                        <div class="accordion-right">
                            ${statusDot}
                            <span class="accordion-meta">${sessions.length} attendees</span>
                            <span class="accordion-meta">⏱ ${meetingDuration}</span>
                            <span class="accordion-chevron" id="chev-${mid}">▸</span>
                        </div>
                    </button>
                    <div class="accordion-body hidden" id="body-${mid}">
                        ${renderMeetingBody(sessions)}
                    </div>
                `;
                container.appendChild(accordion);
            });
        }
    );
}

function renderMeetingBody(sessions) {
    if (sessions.length === 0)
        return '<div class="empty" style="padding:1.5rem;">No attendees for this meeting</div>';

    const rows = sessions.map(s => {
        const { name, id } = resolveDisplay(s);

        // Hours: voided if rejected
        let durationStr = "—";
        if (s.hoursVoided) {
            durationStr = '<span style="color:var(--red);text-decoration:line-through;">' +
                (s.checkOutTime ? ((s.checkOutTime - s.checkInTime)/3600000).toFixed(2) + " hrs" : "—") +
                '</span> <span style="color:var(--red);font-size:0.7rem;">VOIDED</span>';
        } else if (s.checkInTime && s.checkOutTime) {
            durationStr = ((s.checkOutTime - s.checkInTime) / 3600000).toFixed(2) + " hrs";
        } else if (!s.checkOutTime) {
            durationStr = "Active";
        }

        const statusTag = s.status === "pending_admin_review"
            ? '<span class="tag emergency" style="font-size:0.65rem;">Emergency</span>'
            : s.status === "approved"
            ? '<span class="tag approved"  style="font-size:0.65rem;">Approved</span>'
            : s.status === "rejected"
            ? '<span class="tag rejected"  style="font-size:0.65rem;">Rejected</span>'
            : s.autoSignedOut
            ? '<span class="tag done"      style="font-size:0.65rem;">Auto out</span>'
            : s.checkOutTime
            ? '<span class="tag done"      style="font-size:0.65rem;">Done</span>'
            : '<span class="tag active"    style="font-size:0.65rem;">Active</span>';

        const noteHtml = s.note
            ? `<div style="font-family:var(--font-mono);font-size:0.68rem;color:var(--text3);margin-top:2px;">${s.note}</div>` : "";

        return `
        <div class="history-row" id="hrow-${s.id}">
            <div class="hrow-info">
                <div class="hrow-name">${name}</div>
                <div class="hrow-id">ID: ${id}</div>
                ${noteHtml}
            </div>
            <div class="hrow-times">
                <span>In: ${s.checkInTime ? new Date(s.checkInTime).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"}) : "—"}</span>
                <span>Out: ${s.checkOutTime ? new Date(s.checkOutTime).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"}) : "—"}</span>
                <span>${durationStr}</span>
            </div>
            <div class="hrow-right">
                ${statusTag}
                <button class="btn-edit" onclick="openEditModal('${s.id}')">Edit</button>
            </div>
        </div>`;
    }).join("");

    return `<div class="history-table">${rows}</div>`;
}

window.toggleAccordion = mid => {
    const body = document.getElementById(`body-${mid}`);
    const chev = document.getElementById(`chev-${mid}`);
    body.classList.toggle("hidden");
    chev.textContent = body.classList.contains("hidden") ? "▸" : "▾";
};

// ============================================================
//  MISSING CARD IDs SECTION
// ============================================================
async function loadMissingCardIds() {
    const container = document.getElementById("missingCards");
    const snap = await getDocs(collection(db, "users"));
    container.innerHTML = "";
    let count = 0;

    snap.forEach(d => {
        const data = d.data();
        if (!data.cardId) {
            count++;
            const row = document.createElement("div");
            row.className = "session-item";
            row.style.marginBottom = "0.6rem";
            row.innerHTML = `
                <div class="flex-between">
                    <div>
                        <div class="session-name">${data.name || "Unknown"}</div>
                        <div style="font-family:var(--font-mono);font-size:0.72rem;color:var(--text3);">School ID: ${data.schoolId || "—"}</div>
                    </div>
                    <button class="btn-edit" onclick="openAssignCard('${d.id}','${data.name || ""}')">Assign Card</button>
                </div>
            `;
            container.appendChild(row);
        }
    });

    document.getElementById("missingCardsCount").innerText = count;
    if (count === 0) container.innerHTML = '<div class="empty">All students have card IDs ✓</div>';
}

window.openAssignCard = (userId, name) => {
    document.getElementById("assignCardUserId").value = userId;
    document.getElementById("assignCardName").innerText = name;
    document.getElementById("assignCardId").value = "";
    document.getElementById("assignCardError").innerText = "";
    document.getElementById("assignCardModal").classList.remove("hidden");
    setTimeout(() => document.getElementById("assignCardId").focus(), 50);
};

document.getElementById("assignCardCancelBtn").onclick = () =>
    document.getElementById("assignCardModal").classList.add("hidden");

document.getElementById("assignCardSaveBtn").onclick = async () => {
    const userId  = document.getElementById("assignCardUserId").value;
    const cardId  = document.getElementById("assignCardId").value.trim();
    const errorEl = document.getElementById("assignCardError");
    errorEl.innerText = "";
    if (!cardId) { errorEl.innerText = "Enter a card ID"; return; }

    // Check duplicate
    const snap = await getDocs(collection(db, "users"));
    let dup = false;
    snap.forEach(d => { if (d.id !== userId && (d.data().cardId || "") === cardId) dup = true; });
    if (dup) { errorEl.innerText = "That card ID is already assigned to another student"; return; }

    await updateDoc(doc(db, "users", userId), { cardId });
    userCache[userId] = { ...(userCache[userId] || {}), cardId };
    document.getElementById("assignCardModal").classList.add("hidden");
    loadMissingCardIds();
};

// ============================================================
//  FLAGS / ALERTS
// ============================================================
async function loadFlags() {
    const container = document.getElementById("flagsList");
    container.innerHTML = "";
    const flags = [];

    const sessionsSnap = await getDocs(collection(db, "sessions"));

    // Group by userId
    const byUser = {};
    sessionsSnap.forEach(d => {
        const s = d.data();
        if (!byUser[s.userId]) byUser[s.userId] = [];
        byUser[s.userId].push({ id: d.id, ...s });
    });

    for (const [userId, sessions] of Object.entries(byUser)) {
        const cached = userCache[userId] || {};
        const name   = cached.name || userId;

        // ── Flag: 3+ rejected emergency leaves
        const rejectedLeaves = sessions.filter(s => s.status === "rejected");
        if (rejectedLeaves.length >= 3) {
            flags.push({
                type: "error",
                icon: "🚫",
                title: `${name} — Repeated rejected leave requests`,
                detail: `${rejectedLeaves.length} rejected emergency leaves on record`
            });
        }

        // ── Flag: 2+ consecutive rejected leaves
        const sorted = [...sessions].sort((a,b) => a.checkInTime - b.checkInTime);
        let consecutive = 0, maxConsec = 0;
        sorted.forEach(s => {
            if (s.status === "rejected") { consecutive++; maxConsec = Math.max(maxConsec, consecutive); }
            else consecutive = 0;
        });
        if (maxConsec >= 2 && rejectedLeaves.length < 3) { // avoid double-flagging
            flags.push({
                type: "warn",
                icon: "⚠️",
                title: `${name} — Consecutive rejected leaves`,
                detail: `${maxConsec} rejected leaves in a row`
            });
        }

        // ── Flag: short session times (< 15 min) 3+ times
        const shortSessions = sessions.filter(s =>
            s.checkInTime && s.checkOutTime &&
            (s.checkOutTime - s.checkInTime) < 15 * 60 * 1000
        );
        if (shortSessions.length >= 3) {
            flags.push({
                type: "warn",
                icon: "⏱",
                title: `${name} — Repeatedly short sessions`,
                detail: `${shortSessions.length} sessions under 15 minutes`
            });
        }

        // ── Flag: 3+ auto-sign-outs (forgot to sign out repeatedly)
        const autoOuts = sessions.filter(s => s.autoSignedOut);
        if (autoOuts.length >= 3) {
            flags.push({
                type: "info",
                icon: "🔔",
                title: `${name} — Frequently auto-signed out`,
                detail: `${autoOuts.length} times auto-signed out at meeting end`
            });
        }
    }

    document.getElementById("flagsCount").innerText = flags.length;

    if (flags.length === 0) {
        container.innerHTML = '<div class="empty">No flags — all clear ✓</div>';
        return;
    }

    flags.forEach(f => {
        const el = document.createElement("div");
        el.className = `flag-item flag-${f.type}`;
        el.innerHTML = `
            <div class="flag-icon">${f.icon}</div>
            <div class="flag-body">
                <div class="flag-title">${f.title}</div>
                <div class="flag-detail">${f.detail}</div>
            </div>
        `;
        container.appendChild(el);
    });
}

// ============================================================
//  EXPORT TO CSV
// ============================================================
window.exportCSV = async () => {
    const sessionsSnap = await getDocs(
        query(collection(db, "sessions"), orderBy("checkInTime", "desc"))
    );
    const meetingsSnap = await getDocs(collection(db, "meetings"));
    const meetingMap = {};
    meetingsSnap.forEach(d => { meetingMap[d.id] = d.data().meetingLabel || d.id; });

    const rows = [["Name", "School ID", "Meeting", "Check In", "Check Out", "Duration (hrs)", "Status", "Early Leave", "Reason", "Hours Voided", "Auto Signed Out", "Note"]];

    sessionsSnap.forEach(d => {
        const s = d.data();
        const { name, id } = resolveDisplay(s);
        const meetingLabel = s.meetingLabel || meetingMap[s.meetingId] || s.meetingId;
        const inTime  = s.checkInTime  ? new Date(s.checkInTime).toLocaleString()  : "";
        const outTime = s.checkOutTime ? new Date(s.checkOutTime).toLocaleString() : "";
        const durHrs  = (s.checkInTime && s.checkOutTime && !s.hoursVoided)
            ? ((s.checkOutTime - s.checkInTime) / 3600000).toFixed(2) : "0";

        rows.push([
            name, id, meetingLabel, inTime, outTime, durHrs,
            s.status || "", s.earlyLeave ? "Yes" : "No",
            s.earlyLeaveReason || "", s.hoursVoided ? "Yes" : "No",
            s.autoSignedOut ? "Yes" : "No", s.note || ""
        ]);
    });

    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `robotics-attendance-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
};

// ============================================================
//  EDIT SESSION MODAL
// ============================================================
let editingSessionId = null;

window.openEditModal = async (sessionId) => {
    editingSessionId = sessionId;
    const allSessions = await getDocs(collection(db, "sessions"));
    let sd = null;
    allSessions.forEach(d => { if (d.id === sessionId) sd = d.data(); });
    if (!sd) return;
    const { name, id } = resolveDisplay(sd);
    document.getElementById("editModalTitle").innerText = `Edit: ${name}`;
    document.getElementById("editName").value      = sd.displayName || name || "";
    document.getElementById("editStudentId").value = sd.displayId   || id  || "";
    document.getElementById("editCheckIn").value   = sd.checkInTime  ? toDatetimeLocal(sd.checkInTime)  : "";
    document.getElementById("editCheckOut").value  = sd.checkOutTime ? toDatetimeLocal(sd.checkOutTime) : "";
    document.getElementById("editReason").value    = sd.earlyLeaveReason || "";
    document.getElementById("editError").innerText = "";
    document.getElementById("editModal").classList.remove("hidden");
};

document.getElementById("editCancelBtn").onclick = () => {
    document.getElementById("editModal").classList.add("hidden");
    editingSessionId = null;
};

document.getElementById("editSaveBtn").onclick = async () => {
    if (!editingSessionId) return;
    const errorEl     = document.getElementById("editError");
    const checkInVal  = document.getElementById("editCheckIn").value;
    const checkOutVal = document.getElementById("editCheckOut").value;
    errorEl.innerText = "";
    if (!checkInVal) { errorEl.innerText = "Check-in time is required"; return; }
    const checkInTs  = new Date(checkInVal).getTime();
    const checkOutTs = checkOutVal ? new Date(checkOutVal).getTime() : null;
    if (checkOutTs && checkOutTs <= checkInTs) { errorEl.innerText = "Check-out must be after check-in"; return; }
    const updates = {
        displayName:  document.getElementById("editName").value.trim(),
        displayId:    document.getElementById("editStudentId").value.trim(),
        checkInTime:  checkInTs,
        checkOutTime: checkOutTs,
    };
    const reasonVal = document.getElementById("editReason").value.trim();
    if (reasonVal) { updates.earlyLeaveReason = reasonVal; updates.earlyLeave = true; }
    try {
        await updateDoc(doc(db, "sessions", editingSessionId), updates);
        document.getElementById("editModal").classList.add("hidden");
        editingSessionId = null;
        loadMeetingHistory();
    } catch (err) {
        errorEl.innerText = "Save failed: " + err.message;
    }
};

// ============================================================
//  ADD STUDENT MODAL
// ============================================================
window.openAddStudent = () => {
    ["addName","addSchoolId","addCardId"].forEach(id => document.getElementById(id).value = "");
    ["addStudentError","addStudentSuccess"].forEach(id => document.getElementById(id).innerText = "");
    document.getElementById("addStudentModal").classList.remove("hidden");
    setTimeout(() => document.getElementById("addName").focus(), 50);
};
document.getElementById("addStudentCancelBtn").onclick = () =>
    document.getElementById("addStudentModal").classList.add("hidden");

document.getElementById("addStudentSaveBtn").onclick = async () => {
    const errorEl   = document.getElementById("addStudentError");
    const successEl = document.getElementById("addStudentSuccess");
    errorEl.innerText = successEl.innerText = "";
    const name     = document.getElementById("addName").value.trim();
    const schoolId = document.getElementById("addSchoolId").value.trim();
    const cardId   = document.getElementById("addCardId").value.trim(); // optional

    if (!name)     { errorEl.innerText = "Name is required";      return; }
    if (!schoolId) { errorEl.innerText = "School ID is required"; return; }

    const existingSnap = await getDocs(collection(db, "users"));
    let dupSchool = false, dupCard = false;
    existingSnap.forEach(d => {
        const data = d.data();
        if ((data.schoolId || "") === schoolId) dupSchool = true;
        if (cardId && (data.cardId || "") === cardId) dupCard = true;
    });
    if (dupSchool) { errorEl.innerText = "School ID already exists"; return; }
    if (dupCard)   { errorEl.innerText = "Card ID already assigned to another student"; return; }

    const newUser = { name, schoolId, createdAt: Date.now() };
    if (cardId) newUser.cardId = cardId;

    try {
        const ref = await addDoc(collection(db, "users"), newUser);
        userCache[ref.id] = { name, displayId: schoolId, schoolId, cardId: cardId || "" };
        successEl.innerText = `✓ ${name} added successfully`;
        ["addName","addSchoolId","addCardId"].forEach(id => document.getElementById(id).value = "");
        setTimeout(() => {
            document.getElementById("addStudentModal").classList.add("hidden");
            loadMissingCardIds();
        }, 1500);
    } catch (err) {
        errorEl.innerText = "Error: " + err.message;
    }
};

// ============================================================
//  UTIL
// ============================================================
function toDatetimeLocal(ts) {
    const d   = new Date(ts);
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}