# Memory: index.md
Updated: just now

# Project Memory

## Core
Prime Care VIP brand: Midnight Care navy #04244C (primary), Pulse Blue/Bright Aqua #00B8FF (accent/CTA), Pure Calm #F5F4EE (bg), WellSpring green #00C853 (success), Pink #EB3774 (alert/destructive).
Light theme. Tinos serif for headings (h1-h4), Roboto sans for body, Roboto Mono for data. Tone: warm, confident, human — not cyberpunk/sterile.
All colors via semantic tokens in index.css (HSL). Never hardcode hex/Tailwind color classes in components.
Logo at src/assets/primecare-logo.jpg — used in Sidebar header on white card.
Lovable Cloud (Supabase) backend. Sandbox edge functions: hint-sandbox, elation-sandbox, fhir-medications-sandbox, fhir-labs-sandbox.
Elation integration is READ-ONLY (analytics pull only). Never push data back to Elation or to patients — no POST/PATCH/DELETE, no messages/letters/bills/DocumentReference resources.
