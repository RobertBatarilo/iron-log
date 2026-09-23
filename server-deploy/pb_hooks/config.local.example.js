// Vorlage: auf dem Server nach pb_hooks/config.local.js kopieren und mit echten Werten fuellen.
// config.local.js selbst NIEMALS committen (enthaelt das interne Secret).
module.exports = {
  pushServiceUrl: "http://push-service:3001/send-push",
  pushInternalSecret: "HIER_DAS_GLEICHE_SECRET_WIE_INTERNAL_SECRET_IM_PUSH_SERVICE",
  aiPhotoServiceUrl: "http://ai-photo-service:3002/parse-photo",
  aiPhotoInternalSecret: "HIER_DAS_GLEICHE_SECRET_WIE_AI_PHOTO_INTERNAL_SECRET_IM_AI_PHOTO_SERVICE",
  // Guthabenkarten-Modul (credit_checkout.pb.js, credit_redemption.pb.js):
  stripeSecretKey: "sk_test_...", // Stripe Testmodus-Secret-Key der Plattform
  // Muss exakt STRIPE_WEBHOOK_INTERNAL_SECRET im .env des stripe-webhook-service entsprechen
  stripeWebhookInternalSecret: "HIER_DAS_GLEICHE_SECRET_WIE_STRIPE_WEBHOOK_INTERNAL_SECRET_IM_STRIPE_WEBHOOK_SERVICE",
  appBaseUrl: "https://robertbatarilo.github.io/iron-log/index.html" // fuer Stripe success_url/cancel_url/return_url
};
