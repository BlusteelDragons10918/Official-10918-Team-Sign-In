import { app, db } from "./firebase.js";
import {
    collection,
    getDocs,
    query,
    where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

let allStudents = [];

async function loadStudents() {
    const usersSnap = await getDocs(collection(db, "users"));
    const sessionsSnap = await getDocs(collection(db, "sessions"));

    // Build hours map keyed by firestoreId
    const hoursMap = {};
    const sessionCountMap = {};

    sessionsSnap.forEach(d => {
        const s = d.data();
        if (!s.userId) return;
        if (!hoursMap[s.userId]) { hoursMap[s.userId] = 0; sessionCountMap[s.userId] = 0; }
        sessionCountMap[s.userId]++;
        if (s.checkOutTime && s.checkInTime) {
            hoursMap[s.userId] += (s.checkOutTime - s.checkInTime) / 3600000;
        }
    });

    allStudents = [];

    usersSnap.forEach(docu => {
        const data = docu.data();
        const fid = docu.id;
        allStudents.push({
            firestoreId: fid,
            name: data.name || "Unknown",
            displayId: data.schoolId || data.cardId || data.identifiers?.[0]?.value || fid,
            hours: hoursMap[fid] || 0,
            sessions: sessionCountMap[fid] || 0
        });
    });

    // Sort alphabetically
    allStudents.sort((a, b) => a.name.localeCompare(b.name));
    renderStudents(allStudents);
}

function renderStudents(students) {
    const container = document.getElementById("studentList");
    container.innerHTML = "";

    if (students.length === 0) {
        container.innerHTML = '<div class="empty" style="grid-column:1/-1;">No students found</div>';
        return;
    }

    students.forEach(s => {
        const initials = s.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

        const card = document.createElement("a");
        card.className = "student-card";
        card.href = `studentDashboard.html?id=${s.firestoreId}`;

        card.innerHTML = `
            <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.25rem;">
                <div style="
                    width:36px;height:36px;border-radius:50%;
                    background:linear-gradient(135deg,var(--cyan),var(--blue));
                    display:flex;align-items:center;justify-content:center;
                    font-family:var(--font-display);font-weight:800;font-size:0.8rem;color:var(--bg);
                    flex-shrink:0;
                ">${initials}</div>
                <div>
                    <div class="student-name">${s.name}</div>
                    <div class="student-id">ID: ${s.displayId}</div>
                </div>
            </div>
            <div class="student-hours">${s.hours.toFixed(1)} hrs · ${s.sessions} sessions</div>
        `;

        container.appendChild(card);
    });
}

// Search
document.getElementById("searchBox").addEventListener("input", (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = allStudents.filter(s =>
        s.name.toLowerCase().includes(term) ||
        s.displayId.toString().includes(term)
    );
    renderStudents(filtered);
});

loadStudents();