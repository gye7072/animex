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
from cfbypass import CF_Solver
import requests
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')


cookies = {
}

async def main(domain):
    solver = CF_Solver(
        domain=domain,
        headless=True,         # Set to True to run without UI
        slow_mo=100,            # Optional: adds delay between steps
        poll_interval=1.0,      # Check for cookies every second
        max_wait=90.0           # Wait up to 90 seconds
    )

    try:
        cf_cookie = await solver.bypass()
        # print(cf_cookie)
        cookies["cf_clearance"] = cf_cookie
    finally:
        await solver.close()

if __name__ == "__main__":
    
    domain = sys.argv[1]
    request = sys.argv[2]
    headers = json.loads(sys.argv[3])
    asyncio.run(main(domain))
    
    response = requests.get(request, headers=headers, cookies=cookies)
    print(response.text)

    