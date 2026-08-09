export async function run(args, context) {
  const { print, room, participant, session, EXIT } = context;
  const out = {
    ok: true,
    room_id: room || null,
    participant_id: participant || null,
    jwt_expires_at: session.expires_at || null
  };
  if (args.json) print(JSON.stringify(out));
  else
    print(
      `room: ${out.room_id || '-'}\nparticipant: ${out.participant_id || '-'}\njwt exp: ${out.jwt_expires_at || '-'}`
    );
  return EXIT.OK;
}
