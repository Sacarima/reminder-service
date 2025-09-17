// Stub SMS sender: pretend to send and return a fake provider id.
export async function sendSmsDevStub(
  toE164: string,
  body: string,
): Promise<string> {
  // In real life you’d call Twilio/etc here.
  // We return a deterministic id-like string for auditing.
  return `sms-stub:${toE164}:${Date.now()}`;
}
