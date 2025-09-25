// Authoritative timer Watcher (skeleton)
// TODO: poll DB for rounds in 'submit'/'final_vote' and broadcast ends_unix via Realtime/WS
export async function tick() {
  // no-op stub
}

if (import.meta.url === `file://${process.argv[1]}`) {
  setInterval(tick, 4000);
}

