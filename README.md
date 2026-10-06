# Official-10918-Team-Sign-In
This is the official sign-in page used for tracking attendance for students who attend Robotics. 

# How it works
  ## Pre-Requisite
  Admin(s) will need to add students into the database. This is either through their school given id (eg. 8895572) and/or the number given          through scanning the students physical id card. A school given id is required. 

  ## Starting & Ending a Meeting
  To start a meeting, first sign in using the Admin link, then return to the scan page and click Start in the top right corner. Signed-out visitors see “Please sign in as admin” and cannot start a meeting through the website. Public pages and student ID scanning remain accessible without an admin login. To end a meeting, there is a button in the top right corner of    the scan page.

  ## Signing In
  To sign in, students need to either type their school given id (eg. 8895572) or scan their physical card. If typing, students will need to        press enter, but if scanning, students do not need to do anything further. 

  ## Signing Out
  To sign out, students need to either enter their school given id or scan their id card again. If sign-out is within 30 minutes of sign-in, it     will count as an "emergency leave". Students will be required to put a reason which will then be submitted and then checked over by admin. If     the reason is not valid, minutes for that day will not count towards a students total hours. 

  If a student forgets to sign out, by the time the meeting ends, it will automatically sign the student out. The hours for that session are removed from the student’s total. Their profile shows “Auto Sign-Out,” the original duration crossed out, and zero credited hours. The directory, admin history, and CSV export also exclude those hours, including older sessions already marked as auto-signed out. Each time a student forgets to sign out, it will be noted within their profile. If the student forgets to sign out repeatedly, their profile will be flagged and shown in the admin page.

  ## Student Directory
  Each student has the ability to see how many hours they have and a report of which meetings they attended and missed. They can view other         students as well, but have no editing access to any of this data. 

  ## Admin Controls
  Admin(s) controls include: <br>
    - Adding students with their full name, school given id, and physical card id. <br>
    - Seeing current live sessions, and end anyone's session. <br>
    - Accepting/rejecting emergency leaves <br>
    - Seeing trends in students who are flagged (repeated rejected emergency leaves, repeated auto-sign outs) <br>
    - Seeing who attended what meeting and edit certain fields within each meeting <br>

This website is hosted on [Vercel]([url](https://official-10918-team-sign-in.vercel.app/index.html)) and all data is stored using Firebase. 
If you have any suggestions on what to add/bug fixes on the website, please send an email to frc10918@gmail.com



## Admin corrections
Admins can use **Clear Flag** to dismiss a specific attendance warning. Dismissals persist after refresh; a new qualifying session can raise the warning again. Clearing a flag does not change attendance or hours.

In meeting history, choose **Edit**, check **Restore removed hours**, and save to include an automatically signed-out or rejected session in the student's total again. The original history remains visible. Uncheck the option to remove the hours again. Directory totals, student profiles, and CSV exports honor this override. These controls appear only on the admin page and require an authenticated admin-page session; database write permissions remain governed by your existing Firebase rules.

The Start button uses the same Firebase sign-in as the existing admin page (this project does not define separate account roles). This is a website check; database-level restrictions depend on the Firebase rules configured for the project, which are not included in this repository.

## Reopening a meeting
Starting again on the same local calendar day reopens the most recent meeting for that day with its original number, label, and start time. Students automatically signed out by its latest ending resume their original sessions with no auto-sign-out penalty; their original check-in times are kept, so a later normal sign-out includes the whole interval. Manual sign-outs and emergency leave decisions are unchanged. Ending the reopened meeting still applies the normal automatic sign-out policy to anyone who has not signed out. Starting on a new day creates a new meeting.

## Excel attendance summary
**Export Excel** downloads an `.xlsx` workbook with one row per student and a Report Guide explaining the metrics and rating. Missed meetings begin on the local calendar day of the student's `createdAt` database creation date. Older records without that field show N/A for missed meetings and ratings rather than assuming an enrollment date. Only ended meetings are included. The report preserves school IDs as text, includes semicolon-separated missed dates and leave reasons, and honors removed/restored hours. The optional ExcelJS 4.4.0 browser library loads from jsDelivr only when exporting; a failed download displays an error and allows retry.

## First meeting in the directory
Student cards show their first recorded attendance date. Profiles highlight the first attended meeting on or after enrollment in purple with a celebration icon, while retaining leave/sign-out status labels. Meetings before the day the student was added (`createdAt`) are omitted from profile history and missed totals. Older records without a creation date show recorded sessions and N/A missed meetings rather than guessed absences.

## Meetings before first attendance
Profiles retain earlier meetings in gray as **Before you joined**, excluded from missed totals. Once a student attends, the first attended meeting on or after database enrollment is the attendance cutoff for profiles and Excel exports. Until then, the database creation day is used. If creation date is missing, first recorded attendance supplies the cutoff; if both are unknown, missed counts remain unavailable. The first attended meeting keeps its purple celebration highlight.

## Editing a student profile
Signed-in admins can open a student from the directory and click the pencil in the profile's upper-right corner. The existing name, school ID and optional card ID are prefilled in an Add Student-style dialog. Saving updates that student without replacing attendance history or enrollment date; duplicate IDs used by other students are rejected. First-meeting dates appear only on individual profiles, not directory cards. Profile editing uses the same Firebase authentication as the admin page; database authorization remains controlled by the project's Firebase rules.
