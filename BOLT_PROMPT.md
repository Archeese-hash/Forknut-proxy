# Bolt.new build instructions for Forknut Proxy

Paste the following into Bolt after importing this project:

Build and deploy this project as **Forknut Proxy**.

Keep the existing visual design exactly as-is:
- Name: Forknut Proxy
- Large “Made by Archie Faulkner” attribution
- Dark navy/purple theme
- URL input and Go button
- Responsive/iPad-friendly layout

Turn it into a real, working proxy using the **official MercuryWorkshop Scramjet ecosystem**, including its documented Scramjet client, service worker, transport, and Wisp server components. Do not replace the proxy with a simple iframe or a client-side fetch.

Use the official Scramjet-App repository/documentation as the implementation reference:
https://github.com/MercuryWorkshop/Scramjet-App

Requirements:
1. Keep the Forknut UI.
2. Add the Scramjet client and service-worker assets correctly.
3. Configure the Wisp/transport server required by Scramjet.
4. Make the URL form navigate through Scramjet.
5. Bind the server to 0.0.0.0 and use the PORT environment variable.
6. Add sensible URL validation and rate limiting/SSRF protections appropriate for a public deployment.
7. Test the app before deploying it.
8. Deploy it and return the public HTTPS URL.

Do not claim it is a working proxy until the deployed server has actually started and the proxy route has been tested.
