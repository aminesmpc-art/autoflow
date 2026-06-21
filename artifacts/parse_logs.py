import sys
import re

def main():
    lines = sys.stdin.read().splitlines()
    print(f"Total lines analyzed: {len(lines)}")
    
    status_counts = {}
    errors = []
    signups = []
    verifications = []
    scans = []
    
    for l in lines:
        if not l.strip():
            continue
        # Strip timestamps
        l_clean = re.sub(r'^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d+\]\s*', '', l)
        
        # Track user signups / verifications
        if "apps.users.services:" in l:
            if "Verification email sent" in l:
                signups.append(l_clean)
            elif "Email verified" in l:
                verifications.append(l_clean)
                
        # Track requests and responses
        elif "django.request:" in l:
            req_msg = l_clean.split("django.request:")[-1].strip()
            status_counts[req_msg] = status_counts.get(req_msg, 0) + 1
            if "500" in l or "Internal Server Error" in l:
                errors.append(l)
                
        # Scanner detection
        if any(keyword in l.lower() for keyword in [".git/config", "wp-admin", "xmlrpc.php", ".env"]):
            scans.append(l_clean)

    print("\n--- USER REGISTRATION METRICS ---")
    print(f"Sign-up emails dispatched: {len(signups)}")
    print(f"Successfully verified users: {len(verifications)}")
    if verifications:
        conversion_rate = (len(verifications) / len(signups)) * 100 if signups else 0
        print(f"Verification Conversion Rate: {conversion_rate:.1f}%")
        
    print("\n--- RECENT VERIFIED USERS ---")
    for user_log in verifications[-5:]:
        # Extract email
        match = re.search(r"verified for user (.*)", user_log)
        if match:
            print(f" * {match.group(1)}")
            
    print("\n--- APIS REQUEST COUNTS & WARNINGS ---")
    sorted_status = sorted(status_counts.items(), key=lambda x: x[1], reverse=True)
    for req, count in sorted_status[:15]:
        print(f" {count:3d}x  - {req}")
        
    print("\n--- DETECTED BOT SCANS ---")
    print(f"Total malicious scanner requests: {len(scans)}")
    for scan in scans[-3:]:
        print(f" ! {scan}")
        
    print("\n--- SERVER ERROR LOGS (500 Internal) ---")
    print(f"Total 500 server errors: {len(errors)}")
    for err in errors[:5]:
        print(f" [ERROR] {err}")

if __name__ == '__main__':
    main()
