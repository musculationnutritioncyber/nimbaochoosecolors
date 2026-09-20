# Nimbao color vote

Swipe page (`index.html`) where customers love / nope new colorways, and an admin page (`/admin`, PIN) with the ranking.

Vercel setup: connect a **Blob store** to the project (gives `BLOB_READ_WRITE_TOKEN`) and add the env var **`ADMIN_PIN`**.
Local demo: `python3 dev_server.py` then http://localhost:8791 (local PIN 0000).
