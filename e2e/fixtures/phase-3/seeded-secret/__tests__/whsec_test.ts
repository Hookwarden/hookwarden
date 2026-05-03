// Test fixture seeded with a hardcoded whsec_* value INSIDE an Express webhook handler.
// Phase 3 success criterion #4 RULES-05: the hardcoded-secret-prefix rule fires;
// path_severity_overrides downgrades severity to info because the path matches
// **/__tests__/**. Finding state remains not-verified — only severity drops.
//
// IMPORTANT: the literal bytes "whsec_test_FAKE_DEADBEEF" MUST live inside the arrow
// function body. Engine evidence.ts:29 slices source_text[handler_source_start ..
// handler_source_end] and checks handlerText.includes(prefix). A module-scope const with
// the literal does NOT satisfy this — the slice excludes it. Keep the declaration inside
// the handler block, single occurrence.

import express from 'express';

const app = express();

app.post('/webhook', (req, res) => {
  // Hardcoded secret literal INSIDE handler body — exercises RULES-05 path_severity_overrides downgrade.
  const STRIPE_SECRET = "whsec_test_FAKE_DEADBEEF";
  void STRIPE_SECRET;
  res.status(200).send('ok');
});

export default app;
