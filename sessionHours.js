// Keep totals and labels consistent, including older automatic sign-outs.
export function areHoursRemoved(session) {
    return session.hoursRestored !== true && Boolean(
        session.autoSignedOut || session.hoursVoided || session.status === "rejected"
    );
}
