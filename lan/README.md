# STARS offline copy (LAN fallback)

When campus internet is down, the OSA keeps working on a copy of STARS that runs on one laptop or PC on the office network. The cloud stays the official record. The copy refreshes from it every 5 minutes, lets staff sign in with their usual password and look everything up, and shows a banner with how old it is. Nothing is saved on it: changes wait for the internet, and anything that cannot wait goes on the paper downtime form.

This is Phase 1 of the offline plan. Phase 2 adds a few actions that are kept offline and uploaded later (gate scans, ID validation at the counter).

## What runs

| Part | What it does |
| --- | --- |
| Supabase, self-hosted | Database, sign-in and file storage, at the pinned version in `setup.mjs` |
| STARS (`stars-app`) | The same app as online, built with `STARS_OFFLINE=true`: read-only, with the offline banner |
| Caddy | The one address every device uses, over HTTPS with its own certificate |
| Copy job (`sync`) | Copies the cloud's data every 5 minutes, and writes an encrypted backup every night after 2 AM |

Only Caddy listens on the network (ports 80 and 443). The database and Supabase's API are reachable from this machine only.

## Requirements

- Windows with **Docker Desktop**, or Ubuntu with Docker Engine; 4 cores, 8 GB RAM at least (16 GB comfortable), 20 GB free disk.
- **Git Bash** on Windows (it comes with Git), for the first setup.
- Internet the first time, to download Supabase and build STARS.
- A **fixed address** for this machine that OSA devices can reach. For a demo, turn on **Windows Mobile Hotspot**: the laptop is then always `192.168.137.1`, and phones join its Wi-Fi.

## First-time setup

Run these from the `tup-usms` folder in Git Bash.

1. **Prepare the install** (downloads Supabase's files and generates this install's own keys):
   ```bash
   node lan/setup.mjs --host 192.168.137.1
   ```
2. **Connect it to the cloud.** In the Supabase dashboard, open *Connect → Session pooler* and copy the connection string. Paste it into `lan/.env` as `CLOUD_DB_URL=`, with the database password filled in. Keep this file private: it can read the whole cloud database.
3. **Save the backup passphrase.** `lan/.env` also holds `BACKUP_PASSPHRASE`. Copy it into a password manager or onto paper kept in a locked drawer. Without it, no backup can be opened.
4. **Start everything** (several minutes the first time):
   ```bash
   node lan/stars.mjs up
   ```
5. **Create the database tables:**
   ```bash
   node lan/stars.mjs migrate
   ```
6. **Copy from the cloud now**, rather than waiting 5 minutes:
   ```bash
   node lan/stars.mjs sync
   ```
7. **Install the certificate on each OSA PC and phone** (once per device):
   ```bash
   node lan/stars.mjs cert
   ```
   This saves `lan/stars-root-ca.crt`.
   - **Windows:** double-click it → *Install Certificate* → *Local Machine* → *Trusted Root Certification Authorities*.
   - **Android:** *Settings → Security → Encryption & credentials → Install a certificate → CA certificate*.
   - **iPhone:** AirDrop or email it, install the profile, then turn it on under *Settings → General → About → Certificate Trust Settings*.

   Without it, browsers show a warning and block the camera the kiosk uses.
8. Open **https://192.168.137.1** (or your address). Sign in with a staff account: same login ID, same password as online.

## Every day

| To | Run |
| --- | --- |
| See what is running | `node lan/stars.mjs status` |
| Copy from the cloud now | `node lan/stars.mjs sync` |
| Back up now | `node lan/stars.mjs backup` |
| Read the logs | `node lan/stars.mjs logs` (or `logs sync`, `logs stars-app`) |
| Stop (data is kept) | `node lan/stars.mjs down` |

After pulling new STARS code, run `up` again (it rebuilds) and `migrate`.

## During an outage

1. Staff open the STARS Offline bookmark (`https://192.168.137.1`).
2. The amber banner shows how old the records are. If it is **red**, the copy is over an hour old: confirm suspensions with the OSA head.
3. Save buttons are greyed out. Record anything that cannot wait on the paper downtime form, and enter it online once the internet is back.
4. Students cannot sign in to the copy; they use the cloud on mobile data, or wait.

## Privacy and security (RA 10173)

- The copy holds every student's records. Turn on **full-disk encryption** (BitLocker on Windows, LUKS on Ubuntu) and keep the machine in a locked room or cabinet.
- Only **staff accounts** can sign in: students' accounts are copied without their passwords.
- Backups in `lan/backups` are **encrypted** with `BACKUP_PASSPHRASE`; the last 14 are kept. Copy them to an external drive that is itself encrypted (BitLocker To Go).
- `lan/.env` and `lan/supabase/.env` hold this install's secrets and the cloud connection. They are never committed to Git.

## Restoring a backup

```bash
# Inside the copy job's container, which has the tools and the passphrase:
docker exec -it stars-sync sh
openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASSPHRASE -in /backups/stars-lan-YYYY-MM-DD_HHMM.dump.enc \
  | pg_restore --clean --if-exists --no-owner -d "$LAN_DB_URL"
```

The next 5-minute copy from the cloud replaces the data anyway; a restore matters only when the cloud is unreachable for a long time.

## Changing the address

Run `node lan/setup.mjs --host <new address>`, then `node lan/stars.mjs up`. The address is built into STARS, so it rebuilds, and devices need the same certificate as before.
