export async function run(args, context) {
  const { randomNonce } = context;
  args.nonce = randomNonce();
  const submit = await import('./submit.js');
  return submit.run(args, context);
}
