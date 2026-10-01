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
