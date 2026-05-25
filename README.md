# Official-10918-Team-Sign-In
This is the official sign-in page used for tracking attendance for students who attend Robotics. 

# How it works
  ## Pre-Requisite
  Admin(s) will need to add students into the database. This is either through their school given id (eg. 8895572) and/or the number given          through scanning the students physical id card. A school given id is required. 

  ## Starting & Ending a Meeting
  To start a meeting, there is a button in the top right corner of the scan page. To end a meeting, there is a button in the top right corner of    the scan page. 

  ## Signing In
  To sign in, students need to either type their school given id (eg. 8895572) or scan their physical card. If typing, students will need to        press enter, but if scanning, students do not need to do anything further. 

  ## Signing Out
  To sign out, students need to either enter their school given id or scan their id card again. If sign-out is within 30 minutes of sign-in, it     will count as an "emergency leave". Students will be required to put a reason which will then be submitted and then checked over by admin. If     the reason is not valid, minutes for that day will not count towards a students total hours. 

  If a student forgets to sign out, by the time the meeting ends, it will automatically sign the student out. Each time a student forgets to sign   out, it will be noted within their profile. If the student forgets to sign out repeatedly, their profile will be flagged and shown in the admin   page. 

  ## Student Directory
  Each student has the ability to see how many hours they have and a report of which meetings they attended and missed. They can view other         students as well, but have no editing access to any of this data. 

  ## Admin Controls
  Admin(s) controls include: 
    - They can add students with their full name, school given id, and physical card id. \n
    - They can see current live sessions, and end anyone's session. \n
    - They can accept/reject emergency leaves \n
    - They can see trends in students who are flagged (repeated rejected emergency leaves, repeated auto-sign outs) \n
    - They can see who attended what meeting and edit certain fields within each meeting \n

This website is hosted on [Vercel]([url](https://official-10918-team-sign-in.vercel.app/index.html)) and all data is stored using Firebase. 
If you have any suggestions on what to add/bug fixes on the website, please send an email to frc10918@gmail.com


