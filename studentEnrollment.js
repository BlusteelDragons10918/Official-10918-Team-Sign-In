export function enrollmentTimestamp(value) {
    const ms = value?.toMillis ? value.toMillis() : value && typeof value === "object" && "seconds" in value
        ? value.seconds * 1000 : value instanceof Date ? value.getTime() : typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
    return Number.isFinite(ms) ? ms : null;
}

export function isOnOrAfterEnrollment(timestamp, createdAt) {
    const meeting = enrollmentTimestamp(timestamp);
    const joined = enrollmentTimestamp(createdAt);
    if (meeting === null || joined === null) return false;
    const startOfDay = new Date(joined);
    startOfDay.setHours(0, 0, 0, 0);
    return meeting >= startOfDay.getTime();
}

// Attendance begins with the first attended meeting after enrollment, when known.
// Until a student attends, retain the recorded enrollment day as the cutoff.
export function attendanceStart(createdAt, meetings, sessions) {
    const joined = enrollmentTimestamp(createdAt);
    const attendedIds = new Set(sessions.filter(s => enrollmentTimestamp(s.checkInTime) !== null).map(s => s.meetingId));
    const first = meetings.filter(m => attendedIds.has(m.id) && enrollmentTimestamp(m.startTime) !== null &&
        (joined === null || isOnOrAfterEnrollment(m.startTime, joined)))
        .sort((a,b) => enrollmentTimestamp(a.startTime) - enrollmentTimestamp(b.startTime))[0];
    return first ? enrollmentTimestamp(first.startTime) : joined;
}
