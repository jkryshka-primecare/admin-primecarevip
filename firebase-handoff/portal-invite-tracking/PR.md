# Portal invite tracking review

https://github.com/primecarevip/prime-care-vip-app-v2/pull/596

Commit: aa9683f9d1db1fc71a3b26424721d3ee5710e06b

Five sender tests passed locally; new CI pending. Committed sender and test bytes read back from GitHub and matched local files. Adds plain-text + HTML alternatives and static mailbox List-Unsubscribe; no unsupported List-Unsubscribe-Post. Not merged or deployed; one live test not sent (existing SendGrid secret permission denied).
