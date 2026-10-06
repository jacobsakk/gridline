"""NJCAA football schedule/scores for the HS Game Update tab's Weekly Tracker.

Writes straight into the hsTeams collection -- the same one scraper/hs_games.py's MaxPreps/ScoreStream
pipeline writes to -- using the njcaa-prefixed doc ids njcaa.build_schedule_docs() generates, so it can
never collide with that pipeline's mp_/ss_-prefixed ones. The frontend (useHsTracker in
frontend/src/hsData.js) matches a JUCO player to their team by school name, since they have no
MaxPreps/ScoreStream link to derive the usual doc id from.

Covers NJCAA programs only -- the ~50 schools njcaa.org's own API carries. California's community
colleges (CCCAA) are a separate body not in this feed; until that has its own source, those games are
entered by hand from the Weekly Tracker's "Add game this week" button (see AddGameModal in
frontend/src/HsGameUpdate.jsx).

    python3 juco_schedule.py                  # Firestore in, Firestore out
    python3 juco_schedule.py --dump out.json   # also/instead write the results to a file
"""

import argparse
import json
import os

from njcaa import build_schedule_docs


def firestore_client():
    from google.cloud import firestore
    from google.oauth2 import service_account

    info = json.loads(os.environ["FIREBASE_SERVICE_ACCOUNT"])
    creds = service_account.Credentials.from_service_account_info(info)
    return firestore.Client(project=info["project_id"], credentials=creds)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dump", help="also/instead write the results to this local file")
    ap.add_argument("--no-firestore", action="store_true", help="skip the Firestore write (implied if --dump is given and FIREBASE_SERVICE_ACCOUNT isn't set)")
    args = ap.parse_args()

    print("Fetching NJCAA football schedule...")
    docs = build_schedule_docs()
    print(f"  {len(docs)} teams, {sum(len(d['games']) for d in docs.values())} team-game rows")

    if args.dump:
        with open(args.dump, "w") as f:
            json.dump(docs, f, indent=2)
        print(f"Wrote {args.dump}")

    if args.no_firestore or "FIREBASE_SERVICE_ACCOUNT" not in os.environ:
        if not args.dump:
            print("FIREBASE_SERVICE_ACCOUNT is not set and no --dump given -- nothing to do.")
        return

    client = firestore_client()
    batch, n = client.batch(), 0
    for doc_id, doc in docs.items():
        batch.set(client.collection("hsTeams").document(doc_id), doc)
        n += 1
        if n % 400 == 0:
            batch.commit()
            batch = client.batch()
    if n % 400:
        batch.commit()
    print(f"Wrote {n} hsTeams docs.")


if __name__ == "__main__":
    main()
