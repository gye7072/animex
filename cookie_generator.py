# import asyncio
# from cfbypass import CF_Solver
# import requests
# import json

# cookies = {
# }

# async def get_cookie():
#     solver = CF_Solver(
#         domain="https://animex.one/watch/crest-of-the-stars-290-episode-6",
#         headless=False,         # Set to True to run without UI
#         slow_mo=100,            # Optional: adds delay between steps
#         poll_interval=1.0,      # Check for cookies every second
#         max_wait=90.0           # Wait up to 90 seconds
#     )

#     try:
#         cf_cookie = await solver.bypass()
#         print(f"cf_clearance: {cf_cookie}")
#         cookies["cf_clearance"] = cf_cookie
#     finally:
#         await solver.close()

# # Run the async function
# asyncio.run(get_cookie())

# headers = {
#     "Content-Type": "application/json",
#     "Host": "pp.animex.one", 
#     "Origin": "https://animex.one", 
#     "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:152.0) Gecko/20100101 Firefox/152.0", 
# }


# response = requests.get("https://pp.animex.one/rest/api/sources?id=crest-of-the-stars-vee16&epNum=6&type=sub&providerId=mochi", headers=headers, cookies=cookies)

# print(response.text)




# generate_number.py
import io
import asyncio
import json
import sys
import os
import time
from cfbypass import CF_Solver
import requests

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

CACHE_FILE = os.path.join(os.path.dirname(__file__), '.cf_cache.json')
CACHE_TTL = 3600 * 6  # re-solve at most once every 6 hours; tune as needed

def load_cached_cookie(domain):
    try:
        with open(CACHE_FILE, 'r') as f:
            data = json.load(f)
        entry = data.get(domain)
        if entry and (time.time() - entry['ts']) < CACHE_TTL:
            return entry['cf_clearance']
    except (FileNotFoundError, json.JSONDecodeError, KeyError):
        pass
    return None

def save_cached_cookie(domain, cf_clearance):
    try:
        with open(CACHE_FILE, 'r') as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        data = {}
    data[domain] = {'cf_clearance': cf_clearance, 'ts': time.time()}
    with open(CACHE_FILE, 'w') as f:
        json.dump(data, f)

async def solve(domain):
    solver = CF_Solver(
        domain=domain,
        headless=True,
        slow_mo=100,
        poll_interval=1.0,
        max_wait=90.0
    )
    try:
        return await solver.bypass()
    finally:
        await solver.close()

def fetch_with_cookie(request_url, headers, cf_clearance):
    return requests.get(request_url, headers=headers, cookies={"cf_clearance": cf_clearance})

if __name__ == "__main__":
    domain = sys.argv[1]
    request_url = sys.argv[2]
    headers = json.loads(sys.argv[3])

    cf_clearance = load_cached_cookie(domain)

    if cf_clearance:
        response = fetch_with_cookie(request_url, headers, cf_clearance)
        # If the cached cookie is stale/invalid, the site will usually respond
        # with a 403 or a CF challenge page instead of real JSON — re-solve once.
        if response.status_code in (403, 503) or 'cf-mitigated' in response.headers:
            cf_clearance = asyncio.run(solve(domain))
            save_cached_cookie(domain, cf_clearance)
            response = fetch_with_cookie(request_url, headers, cf_clearance)
    else:
        cf_clearance = asyncio.run(solve(domain))
        save_cached_cookie(domain, cf_clearance)
        response = fetch_with_cookie(request_url, headers, cf_clearance)

    print(response.text)