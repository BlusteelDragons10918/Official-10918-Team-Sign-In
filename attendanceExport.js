import { attendanceStart } from "./studentEnrollment.js";
import { areHoursRemoved } from "./sessionHours.js";

export const HEADERS = ["Name", "School ID Number", "Total Meetings Attended", "Total Meetings Missed", "Dates of Meetings Missed", "Total Auto-Sign Outs", "Emergency Leaves Requested", "Emergency Leaves Approved", "Reasons for Emergency Leaves", "Emergency Leaves Rejected", "Average Hours per Meeting", "Attendance Rating (1–10)"];

export function timestamp(value) {
    const ms = value?.toMillis ? value.toMillis() : value && typeof value === "object" && "seconds" in value
        ? value.seconds * 1000 : value instanceof Date ? value.getTime() : typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
    return Number.isFinite(ms) ? ms : null;
}
function day(ms) { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
function dateText(ms) {
    const d = new Date(ms);
    return `${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}-${String(d.getFullYear()).slice(-2)}`;
}
function hoursFor(sessions) {
    // Merge overlapping intervals so duplicate records cannot inflate credited time.
    const intervals = sessions.filter(s => !areHoursRemoved(s)).map(s => [timestamp(s.checkInTime), timestamp(s.checkOutTime)])
        .filter(([a,b]) => a !== null && b !== null && b > a).sort((a,b) => a[0]-b[0]);
    let total = 0, end = -Infinity;
    for (const [a,b] of intervals) { total += Math.max(0,b-Math.max(a,end)); end = Math.max(end,b); }
    return total / 3600000;
}

export function buildAttendanceReport(users, meetings, sessions, now = Date.now()) {
    // An ongoing/reopened meeting is not yet eligible for a final attendance report.
    const finished = meetings.filter(m => m.active === false && timestamp(m.startTime) !== null && timestamp(m.endTime) !== null && timestamp(m.endTime) <= now)
        .sort((a,b) => timestamp(a.startTime)-timestamp(b.startTime));
    const byUser = new Map();
    sessions.forEach(s => { if (!byUser.has(s.userId)) byUser.set(s.userId, []); byUser.get(s.userId).push(s); });
    const warnings = [];
    const rows = [...users].sort((a,b) => (a.name || "").localeCompare(b.name || "")).map(user => {
        const joined = attendanceStart(user.createdAt, meetings, byUser.get(user.id) || []);
        const eligible = finished.filter(m => joined === null || day(timestamp(m.startTime)) >= day(joined));
        const eligibleIds = new Set(eligible.map(m => m.id));
        const records = (byUser.get(user.id) || []).filter(s => eligibleIds.has(s.meetingId) && timestamp(s.checkInTime) !== null);
        const attendedIds = new Set(records.map(s => s.meetingId));
        const missed = eligible.filter(m => !attendedIds.has(m.id));
        const autoOuts = records.filter(s => s.autoSignedOut).length;
        const leaves = records.filter(s => s.earlyLeave || ["pending_admin_review", "approved", "rejected"].includes(s.status));
        const approved = leaves.filter(s => s.status === "approved").length;
        const rejected = leaves.filter(s => s.status === "rejected").length;
        const pending = leaves.length - approved - rejected;
        const reasons = [...leaves].sort((a,b) => timestamp(a.checkInTime)-timestamp(b.checkInTime)).map(s => {
            const status = s.status === "approved" ? "Approved" : s.status === "rejected" ? "Rejected" : "Pending";
            return `${dateText(timestamp(s.checkInTime))}: ${String(s.earlyLeaveReason || "No reason recorded").replace(/\s+/g," ")} (${status})`;
        }).join("; ");
        let hours = 0, durationTotal = 0, durationCount = 0;
        for (const meeting of eligible.filter(m => attendedIds.has(m.id))) {
            const credited = hoursFor(records.filter(s => s.meetingId === meeting.id));
            hours += credited;
            const duration = (timestamp(meeting.endTime)-timestamp(meeting.startTime))/3600000;
            if (duration > 0) { durationTotal += Math.min(1,credited/duration); durationCount++; }
        }
        const attended = attendedIds.size;
        let rating = "N/A";
        if (joined === null) warnings.push([user.name || user.id, "Creation date and first attendance missing: missed meetings and rating are unavailable."]);
        else if (eligible.length) {
            const durationRate = durationCount ? durationTotal / durationCount : 1;
            const quality = Math.max(0, 1 - .20*Math.min(1,autoOuts/Math.max(1,attended))
                - .20*Math.min(1,rejected/Math.max(1,attended)) - .025*Math.min(1,approved/Math.max(1,attended))
                - .05*Math.min(1,pending/Math.max(1,attended)) - .15*(1-durationRate));
            rating = Math.round((1 + 9 * (attended/eligible.length) * quality)*10)/10;
        }
        const schoolId = user.schoolId ?? user.identifiers?.find(i => /school/i.test(i.type || ""))?.value ?? "";
        return [user.name || "Unknown", String(schoolId), attended, joined === null ? "N/A" : missed.length,
            joined === null ? "Attendance start unknown" : missed.map(m => dateText(timestamp(m.startTime))).join("; "),
            autoOuts, leaves.length, approved, reasons, rejected, attended ? Math.round(hours/attended*100)/100 : 0, rating];
    });
    return {rows, warnings};
}

let excelLibrary;
async function loadExcel() {
    if (window.ExcelJS) return window.ExcelJS;
    if (!excelLibrary) excelLibrary = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
        const timer = setTimeout(() => { script.remove(); reject(new Error("Excel download timed out. Please try again.")); }, 30000);
        script.onload = () => { clearTimeout(timer); window.ExcelJS ? resolve(window.ExcelJS) : reject(new Error("Excel library could not load.")); };
        script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error("Excel library could not load. Check your connection and try again.")); };
        document.head.appendChild(script);
    }).catch(error => { excelLibrary = null; throw error; });
    return excelLibrary;
}

export function createAttendanceWorkbook(ExcelJS, report) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Bluesteel Dragons";
    const sheet = workbook.addWorksheet("Attendance Summary");
    sheet.columns = HEADERS.map((header,i) => ({header, width:[27,20,18,18,40,18,20,20,65,20,20,20][i]}));
    sheet.addRows(report.rows);
    sheet.views = [{state:"frozen",xSplit:2,ySplit:1}];
    sheet.autoFilter = {from:{row:1,column:1},to:{row:Math.max(1,sheet.rowCount),column:12}};
    sheet.getColumn(2).numFmt = "@";
    sheet.getColumn(11).numFmt = "0.00";
    sheet.getColumn(12).numFmt = "0.0";
    sheet.eachRow((row,index) => {
        row.alignment = {vertical:"top",wrapText:true};
        row.height = index === 1 ? 48 : Math.min(300,Math.max(36, 15 * Math.max(Math.ceil(String(row.getCell(5).value || "").length/36),Math.ceil(String(row.getCell(9).value || "").length/60))));
        row.eachCell(cell => {
            cell.font = {name:"Calibri",size:11,color:{argb:index===1?"FFFFFFFF":"FF16324F"},bold:index===1};
            cell.fill = {type:"pattern",pattern:"solid",fgColor:{argb:index===1?"FF174A7E":index%2===0?"FFEAF3FA":"FFFFFFFF"}};
        });
    });
    const notes = workbook.addWorksheet("Report Guide");
    notes.columns = [{header:"Topic",width:30},{header:"Explanation",width:110}];
    notes.addRows([
        ["Scope", "One row per current student. Only ended meetings are included; ongoing or reopened meetings are excluded from all metrics until ended again. Dates use the exporting browser's local calendar."],
        ["Enrollment", "Eligible meetings start on the first attended meeting day on or after database enrollment. Earlier meetings do not count as missed. Until first attendance, the creation day is used. With no creation date, first recorded attendance is used; if neither exists, missed counts and ratings are N/A."],
        ["Attendance", "Each eligible meeting with a student session counts once, including sessions with removed hours. Multiple visits do not increase meetings attended."],
        ["Hours", "Average = credited hours / meetings attended. Removed hours count as zero; admin-restored hours count normally. Overlapping session intervals are merged. No attended meetings gives 0 hours."],
        ["Events", "Auto sign-outs and emergency leaves count session events in eligible ended meetings. Restoring hours or clearing a flag does not erase events. Reopening a meeting reverses its accidental auto sign-outs."],
        ["Reasons", "All emergency leave reasons are listed together with dates and decision status, separated by semicolons. Requested includes approved, rejected and pending requests."],
        ["Rating", "Score = 1 + 9 × attendance rate × quality, rounded to one decimal (1–10). No eligible meetings or unknown attendance start = N/A. No attendance = 1."],
        ["Attendance rate", "Meetings attended / eligible meetings since enrollment."],
        ["Quality", "1 − 0.20 × auto rate − 0.20 × rejected rate − 0.025 × approved rate − 0.05 × pending rate − 0.15 × (1 − duration rate). Each event rate is events / meetings attended, capped at 1; quality is floored at 0."],
        ["Duration rate", "Average across attended meetings of credited hours / full meeting duration, capped at 1 per meeting. Nonpositive meeting durations are ignored for this factor."],
        ["Interpretation", "A suggested attendance indicator, not a judgment of the student. Attendance has the strongest effect; approved emergency leaves have a smaller penalty than rejected leaves. Perfect attendance with full credit and no events earns 10."],
        ...report.warnings
    ]);
    notes.eachRow((row,i) => { row.alignment={vertical:"top",wrapText:true}; row.height=i===1?26:60; if(i===1){row.font={bold:true,color:{argb:"FFFFFFFF"}};row.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF174A7E"}};} });
    notes.views=[{state:"frozen",ySplit:1}];
    return workbook;
}

export async function downloadAttendanceWorkbook(report) {
    const ExcelJS = await loadExcel();
    const workbook = createAttendanceWorkbook(ExcelJS, report);
    const buffer = await workbook.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buffer], {type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
    const link = document.createElement("a");
    link.href=url;
    link.download=`robotics-attendance-${dateText(Date.now())}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
