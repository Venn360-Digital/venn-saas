import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const raw = await req.text(); // pega o body bruto (melhor pra debug)
  console.log("EVOLUTION_WEBHOOK_RAW:", raw);

  // Depois que estiver funcionando, você pode fazer:
  // const data = JSON.parse(raw);

  return NextResponse.json({ ok: true }, { status: 200 });
}

export async function GET() {
  // só pra testar no navegador
  return NextResponse.json({ ok: true }, { status: 200 });
}
