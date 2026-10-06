import { db, auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { collection, getDocs, getDoc, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export function studentEditValues(user) {
    return {
        name: user.name || "",
        schoolId: String(user.schoolId ?? user.identifiers?.find(i => /school/i.test(i.type || ""))?.value ?? ""),
        cardId: String(user.cardId ?? user.identifiers?.find(i => /card/i.test(i.type || ""))?.value ?? "")
    };
}

export function studentEditUpdates(user, values) {
    const old = studentEditValues(user);
    const updates = {...values};
    // Keep legacy scanner aliases in sync so replaced IDs stop matching.
    if (Array.isArray(user.identifiers)) {
        updates.identifiers = user.identifiers.map(identifier => {
            const value = String(identifier.value ?? "");
            if (/school/i.test(identifier.type || "") || (old.schoolId && value === old.schoolId)) return {...identifier, value:values.schoolId};
            if (/card/i.test(identifier.type || "") || (old.cardId && value === old.cardId)) return {...identifier, value:values.cardId};
            return identifier;
        }).filter(identifier => String(identifier.value ?? "").trim());
    }
    return updates;
}

export function setupStudentProfileEditor(userId, refreshProfile) {
    const get = id => document.getElementById(id);
    const button = get("editStudentBtn");
    const modal = get("editStudentModal");
    const save = get("saveStudentBtn");
    const cancel = get("cancelStudentBtn");
    const error = get("editStudentError");
    let saving = false;
    const close = () => { modal.classList.add("hidden"); if (!button.classList.contains("hidden")) button.focus(); };
    onAuthStateChanged(auth, user => {
        button.classList.toggle("hidden", !user);
        if (!user) close();
    });
    button.onclick = async () => {
        if (!auth.currentUser) return;
        button.disabled = true;
        try {
            const snapshot = await getDoc(doc(db, "users", userId));
            if (!snapshot.exists()) throw new Error("Student no longer exists.");
            if (!auth.currentUser) return;
            const values = studentEditValues(snapshot.data());
            get("editStudentName").value = values.name;
            get("editStudentSchoolId").value = values.schoolId;
            get("editStudentCardId").value = values.cardId;
            error.textContent = "";
            modal.classList.remove("hidden");
            get("editStudentName").focus();
        } catch (err) { alert("Could not open student editor: " + err.message); }
        finally { button.disabled = false; }
    };
    cancel.onclick = () => { if (!saving) close(); };
    modal.addEventListener("keydown", event => {
        if (event.key === "Escape" && !saving) close();
        // A card scanner's Enter key must not accidentally submit the edit.
        if (event.key === "Enter" && event.target.tagName === "INPUT") event.preventDefault();
    });
    save.onclick = async () => {
        if (saving || !auth.currentUser) return;
        const values = {
            name:get("editStudentName").value.trim(),
            schoolId:get("editStudentSchoolId").value.trim(),
            cardId:get("editStudentCardId").value.trim()
        };
        error.textContent = "";
        if (!values.name) { error.textContent = "Name is required"; return; }
        if (!values.schoolId) { error.textContent = "School ID is required"; return; }
        saving = true;
        save.disabled = cancel.disabled = true;
        try {
            const students = await getDocs(collection(db, "users"));
            let current = null;
            const requested = [values.schoolId, values.cardId].filter(Boolean);
            students.forEach(d => {
                if (d.id === userId) { current = d.data(); return; }
                const data = d.data();
                const identifiers = [data.schoolId, data.cardId, ...(data.identifiers || []).map(i => i.value)]
                    .filter(v => v !== null && v !== undefined).map(v => String(v).trim());
                if (requested.some(id => identifiers.includes(id))) throw new Error("School ID or Card ID is already assigned to another student.");
            });
            if (!current) throw new Error("Student no longer exists.");
            if (!auth.currentUser) throw new Error("Please sign in as admin again.");
            await updateDoc(doc(db, "users", userId), studentEditUpdates(current, values));
            close();
            try { await refreshProfile(); }
            catch { alert("Student saved. Refresh the page to see the updated profile."); }
        } catch (err) { error.textContent = "Could not save: " + err.message; }
        finally { saving = false; save.disabled = cancel.disabled = false; }
    };
}
