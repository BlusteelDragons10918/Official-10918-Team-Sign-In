import { app, db } from "./firebase.js";
import {
    collection,
    query,
    where,
    onSnapshot,
    updateDoc,
    getDocs,
    addDoc,
    doc,
    orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import { auth } from "./firebase.js";
import {
    signInWithEmailAndPassword,
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

//  USER CACHE 
// Keyed by Firestore user doc ID → { name, displayId }
let userCache = {};

async function buildUserCache() {
    const snap = await getDocs(collection(db, "users"));
    snap.forEach(d => {
        const data = d.data();
        // Support new schema (cardId/schoolId) and old identifiers[] array
        const displayId = data.schoolId || data.cardId
            || data.identifiers?.[0]?.value || d.id;
        userCache[d.id] = {
            name: data.name || "",
            displayId
        };
    });
}

function resolveDisplay(session) {
    // Prefer fields stored on session (new sessions have these)
    const name = session.displayName
        || userCache[session.userId]?.name
        || session.displayId
        || session.userId
        || "Unknown";

    const id = session.displayId
        || userCache[session.userId]?.displayId
        || session.userId
        || "";

    return { name, id };
}

//  AUTH 
document.getElementById("loginBtn").onclick = async () => {
    const email   = document.getElementById("adminEmail").value.trim();
    const pass    = document.getElementById("adminPassword").value;
    const errorEl = document.getElementById("loginError");
    errorEl.innerText = "";
    try {
        await signInWithEmailAndPassword(auth, email, pass);
    } catch {
        errorEl.innerText = "Invalid credentials. Try again.";
    }
};

document.getElementById("adminPassword").addEventListener("keydown", e => {
    if (e.key === "Enter") document.getElementById("loginBtn").click();
});

onAuthStateChanged(auth, async (user) => {
    if (user) {
        document.getElementById("adminLogin").classList.add("hidden");
        document.getElementById("dashboard").classList.remove("hidden");

        await buildUserCache();

        listenMeeting();
        listenSessions();
        listenLeaveRequests();
        loadMeetingHistory();
    } else {
        document.getElementById("adminLogin").classList.remove("hidden");
        document.getElementById("dashboard").classList.add("hidden");
    }
});

window.logout = () => signOut(auth);

//  MEETING STATUS 
function listenMeeting() {
    onSnapshot(collection(db, "meetings"), snap => {
        let active = null;
        snap.forEach(d => { if (d.data().active) active = d.data(); });
        document.getElementById("activeMeeting").innerText =
            active ? active.meetingLabel : "No active meeting";
    });
}

//  LIVE SESSIONS 
function listenSessions() {
    const q = query(collection(db, "sessions"), orderBy("checkInTime", "desc"));

    onSnapshot(q, snap => {
        const container = document.getElementById("sessionList");
        container.innerHTML = "";

        let presentCount = 0;
        const today = new Date().toDateString();
        let todayCount = 0;

        if (snap.empty) {
            container.innerHTML = '<div class="empty">No sessions recorded</div>';
            updateStats(0, 0);
            return;
        }

        snap.forEach(d => {
            const s = d.data();
            if (s.deleted) return;

            if (!s.checkOutTime && s.status === "active") presentCount++;
            if (new Date(s.checkInTime).toDateString() === today) todayCount++;

            const { name, id } = resolveDisplay(s);

            const isActive  = !s.checkOutTime && s.status === "active";
            const isPending = s.status === "pending_admin_review";
            const isApproved= s.status === "approved";
            const isRejected= s.status === "rejected";

            const tagHTML = isActive   ? '<span class="tag active">● Active</span>'
                          : isPending  ? '<span class="tag emergency">🚨 Emergency Leave</span>'
                          : isApproved ? '<span class="tag approved">✓ Approved</span>'
                          : isRejected ? '<span class="tag rejected">✕ Rejected</span>'
                          : '<span class="tag done">Completed</span>';

            const duration = s.checkOutTime
                ? Math.round((s.checkOutTime - s.checkInTime) / 60000) + " min"
                : "In progress";

            const meetingLabel = s.meetingLabel || s.meetingId;

            const el = document.createElement("div");
            el.className = "session-item";
            el.innerHTML = `
                <div class="flex-between">
                    <div>
                        <div class="session-name">${name}</div>
                        <div style="font-family:var(--font-mono);font-size:0.72rem;color:var(--text3);margin-top:2px;">ID: ${id}</div>
                    </div>
                    ${tagHTML}
                </div>
                <div class="session-meta">
                    <span>📋 ${meetingLabel}</span>
                    <span>⏱ ${duration}</span>
                </div>
                <div class="session-meta">
                    <span>In: ${new Date(s.checkInTime).toLocaleString()}</span>
                    ${s.checkOutTime ? `<span>Out: ${new Date(s.checkOutTime).toLocaleString()}</span>` : ""}
                </div>
                ${s.earlyLeave ? `<div class="session-meta" style="color:var(--red);">Reason: ${s.earlyLeaveReason}</div>` : ""}
            `;
            container.appendChild(el);
        });

        updateStats(presentCount, todayCount);
    });
}

function updateStats(present, today) {
    document.getElementById("statPresent").innerText = present;
    document.getElementById("statToday").innerText   = today;
}

//  LEAVE REQUESTS 
function listenLeaveRequests() {
    const q = query(
        collection(db, "sessions"),
        where("status", "==", "pending_admin_review")
    );

    onSnapshot(q, snap => {
        const container = document.getElementById("leaveRequests");
        container.innerHTML = "";

        if (snap.empty) {
            container.innerHTML = '<div class="empty">No pending requests ✓</div>';
            document.getElementById("statPending").innerText = 0;
            return;
        }

        let count = 0;
        snap.forEach(d => {
            const s = d.data();
            count++;
            const { name, id } = resolveDisplay(s);
            const meetingLabel = s.meetingLabel || s.meetingId;

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
                <div class="session-meta">📋 ${meetingLabel}</div>
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

        document.getElementById("statPending").innerText = count;
    });
}

window.approveLeave = async id => {
    await updateDoc(doc(db, "sessions", id), { status: "approved" });
};
window.rejectLeave = async id => {
    await updateDoc(doc(db, "sessions", id), { status: "rejected" });
};

//  MEETING HISTORY 
async function loadMeetingHistory() {
    const container = document.getElementById("meetingHistory");

    // Listen live so new meetings / session changes reflect instantly
    onSnapshot(
        query(collection(db, "meetings"), orderBy("startTime", "desc")),
        async snap => {
            container.innerHTML = "";

            if (snap.empty) {
                container.innerHTML = '<div class="empty">No meetings recorded</div>';
                return;
            }

            // Fetch all sessions once — we'll re-fetch on updates via onSnapshot
            const allSessionsSnap = await getDocs(
                query(collection(db, "sessions"), orderBy("checkInTime", "asc"))
            );

            // Group sessions by meetingId
            const sessionsByMeeting = {};
            allSessionsSnap.forEach(d => {
                const s = d.data();
                if (!sessionsByMeeting[s.meetingId]) sessionsByMeeting[s.meetingId] = [];
                sessionsByMeeting[s.meetingId].push({ id: d.id, ...s });
            });

            snap.forEach(d => {
                const meeting = d.data();
                const meetingDocId = d.id;
                const sessions = sessionsByMeeting[meetingDocId] || [];

                const totalMinutes = sessions.reduce((sum, s) => {
                    if (s.checkInTime && s.checkOutTime) {
                        return sum + (s.checkOutTime - s.checkInTime) / 60000;
                    }
                    return sum;
                }, 0);

                const accordion = document.createElement("div");
                accordion.className = "accordion";

                const statusDot = meeting.active
                    ? '<span class="tag active" style="font-size:0.65rem;">● Live</span>'
                    : '<span class="tag done" style="font-size:0.65rem;">Ended</span>';

                const startDate = new Date(meeting.startTime).toLocaleDateString("en-US", {
                    weekday: "short", month: "short", day: "numeric"
                });
                const startTime = new Date(meeting.startTime).toLocaleTimeString("en-US", {
                    hour: "2-digit", minute: "2-digit"
                });

                accordion.innerHTML = `
                    <button class="accordion-header" onclick="toggleAccordion('${meetingDocId}')">
                        <div class="accordion-left">
                            <span class="accordion-title">${meeting.meetingLabel || "Meeting"}</span>
                            <span class="accordion-sub">${startDate} · ${startTime}</span>
                        </div>
                        <div class="accordion-right">
                            ${statusDot}
                            <span class="accordion-meta">${sessions.length} attendees</span>
                            <span class="accordion-meta">${(totalMinutes / 60).toFixed(1)} hrs total</span>
                            <span class="accordion-chevron" id="chev-${meetingDocId}">▸</span>
                        </div>
                    </button>
                    <div class="accordion-body hidden" id="body-${meetingDocId}">
                        ${renderMeetingBody(sessions, meetingDocId)}
                    </div>
                `;

                container.appendChild(accordion);
            });
        }
    );
}

function renderMeetingBody(sessions, meetingDocId) {
    if (sessions.length === 0) {
        return '<div class="empty" style="padding:1.5rem;">No attendees for this meeting</div>';
    }

    let rows = sessions.map(s => {
        const { name, id } = resolveDisplay(s);

        const checkInStr  = s.checkInTime  ? toDatetimeLocal(s.checkInTime)  : "";
        const checkOutStr = s.checkOutTime ? toDatetimeLocal(s.checkOutTime) : "";

        const duration = s.checkInTime && s.checkOutTime
            ? ((s.checkOutTime - s.checkInTime) / 3600000).toFixed(2) + " hrs"
            : s.checkOutTime ? "—" : "Active";

        const statusTag = s.status === "pending_admin_review"
            ? '<span class="tag emergency" style="font-size:0.65rem;">Emergency</span>'
            : s.status === "approved"
            ? '<span class="tag approved"  style="font-size:0.65rem;">Approved</span>'
            : s.status === "rejected"
            ? '<span class="tag rejected"  style="font-size:0.65rem;">Rejected</span>'
            : s.checkOutTime
            ? '<span class="tag done"      style="font-size:0.65rem;">Done</span>'
            : '<span class="tag active"    style="font-size:0.65rem;">Active</span>';

        return `
        <div class="history-row" id="hrow-${s.id}">
            <div class="hrow-info">
                <div class="hrow-name">${name}</div>
                <div class="hrow-id">ID: ${id}</div>
            </div>
            <div class="hrow-times">
                <span>In: ${s.checkInTime ? new Date(s.checkInTime).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"}) : "—"}</span>
                <span>Out: ${s.checkOutTime ? new Date(s.checkOutTime).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"}) : "—"}</span>
                <span>${duration}</span>
            </div>
            <div class="hrow-right">
                ${statusTag}
                <button class="btn-edit" onclick="openEditModal('${s.id}')">Edit</button>
            </div>
        </div>`;
    }).join("");

    return `<div class="history-table">${rows}</div>`;
}

window.toggleAccordion = (meetingDocId) => {
    const body = document.getElementById(`body-${meetingDocId}`);
    const chev = document.getElementById(`chev-${meetingDocId}`);
    body.classList.toggle("hidden");
    chev.textContent = body.classList.contains("hidden") ? "▸" : "▾";
};

//  EDIT SESSION MODAL 
let editingSessionId = null;

window.openEditModal = async (sessionId) => {
    editingSessionId = sessionId;

    // Fetch the session doc
    const sessionSnap = await getDocs(
        query(collection(db, "sessions"), where("__name__", "==", sessionId))
    );

    // Alternatively get by doc ID directly
    const allSessions = await getDocs(collection(db, "sessions"));
    let sessionData = null;
    allSessions.forEach(d => { if (d.id === sessionId) sessionData = d.data(); });

    if (!sessionData) return;

    const { name, id } = resolveDisplay(sessionData);

    document.getElementById("editModalTitle").innerText = `Edit: ${name}`;
    document.getElementById("editName").value       = sessionData.displayName || name || "";
    document.getElementById("editStudentId").value  = sessionData.displayId   || id  || "";
    document.getElementById("editCheckIn").value    = sessionData.checkInTime  ? toDatetimeLocal(sessionData.checkInTime)  : "";
    document.getElementById("editCheckOut").value   = sessionData.checkOutTime ? toDatetimeLocal(sessionData.checkOutTime) : "";
    document.getElementById("editReason").value     = sessionData.earlyLeaveReason || "";
    document.getElementById("editError").innerText  = "";

    document.getElementById("editModal").classList.remove("hidden");
};

document.getElementById("editCancelBtn").onclick = () => {
    document.getElementById("editModal").classList.add("hidden");
    editingSessionId = null;
};

document.getElementById("editSaveBtn").onclick = async () => {
    if (!editingSessionId) return;

    const errorEl    = document.getElementById("editError");
    const nameVal    = document.getElementById("editName").value.trim();
    const idVal      = document.getElementById("editStudentId").value.trim();
    const checkInVal = document.getElementById("editCheckIn").value;
    const checkOutVal= document.getElementById("editCheckOut").value;
    const reasonVal  = document.getElementById("editReason").value.trim();

    errorEl.innerText = "";

    if (!checkInVal) { errorEl.innerText = "Check-in time is required"; return; }

    const checkInTs  = new Date(checkInVal).getTime();
    const checkOutTs = checkOutVal ? new Date(checkOutVal).getTime() : null;

    if (checkOutTs && checkOutTs <= checkInTs) {
        errorEl.innerText = "Check-out must be after check-in";
        return;
    }

    const updates = {
        displayName: nameVal,
        displayId:   idVal,
        checkInTime: checkInTs,
        checkOutTime: checkOutTs,
    };

    if (reasonVal) {
        updates.earlyLeaveReason = reasonVal;
        updates.earlyLeave = true;
    }

    try {
        await updateDoc(doc(db, "sessions", editingSessionId), updates);
        document.getElementById("editModal").classList.add("hidden");
        editingSessionId = null;
        // Refresh history
        loadMeetingHistory();
    } catch (err) {
        errorEl.innerText = "Save failed: " + err.message;
    }
};

//  UTIL 
function toDatetimeLocal(ts) {
    const d = new Date(ts);
    // Format to "YYYY-MM-DDTHH:MM" for datetime-local input
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

//  ADD STUDENT 
window.openAddStudent = () => {
    document.getElementById("addName").value     = "";
    document.getElementById("addSchoolId").value = "";
    document.getElementById("addCardId").value   = "";
    document.getElementById("addStudentError").innerText   = "";
    document.getElementById("addStudentSuccess").innerText = "";
    document.getElementById("addStudentModal").classList.remove("hidden");
    setTimeout(() => document.getElementById("addName").focus(), 50);
};

document.getElementById("addStudentCancelBtn").onclick = () => {
    document.getElementById("addStudentModal").classList.add("hidden");
};

document.getElementById("addStudentSaveBtn").onclick = async () => {
    const errorEl   = document.getElementById("addStudentError");
    const successEl = document.getElementById("addStudentSuccess");
    errorEl.innerText   = "";
    successEl.innerText = "";

    const name     = document.getElementById("addName").value.trim();
    const schoolId = document.getElementById("addSchoolId").value.trim();
    const cardId   = document.getElementById("addCardId").value.trim();

    if (!name)     { errorEl.innerText = "Name is required";       return; }
    if (!schoolId) { errorEl.innerText = "School ID is required";  return; }
    if (!cardId)   { errorEl.innerText = "Card ID is required";    return; }

    // Check for duplicate schoolId or cardId
    const existingSnap = await getDocs(collection(db, "users"));
    let dupSchool = false, dupCard = false;
    existingSnap.forEach(d => {
        const data = d.data();
        if ((data.schoolId || "").toString().trim() === schoolId) dupSchool = true;
        if ((data.cardId   || "").toString().trim() === cardId)   dupCard   = true;
    });

    if (dupSchool) { errorEl.innerText = "A student with that School ID already exists"; return; }
    if (dupCard)   { errorEl.innerText = "A student with that Card ID already exists";   return; }

    try {
        await addDoc(collection(db, "users"), {
            name,
            schoolId,
            cardId,
            createdAt: Date.now()
        });

        // Update local cache immediately
        userCache[name] = { name, displayId: schoolId };

        successEl.innerText = `✓ ${name} added successfully`;
        document.getElementById("addName").value     = "";
        document.getElementById("addSchoolId").value = "";
        document.getElementById("addCardId").value   = "";

        // Auto-close after 1.5s
        setTimeout(() => {
            document.getElementById("addStudentModal").classList.add("hidden");
        }, 1500);

    } catch (err) {
        errorEl.innerText = "Error: " + err.message;
    }
};