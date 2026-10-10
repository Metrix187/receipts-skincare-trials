import { handle } from "@/lib/http";
import { ownerId } from "@/lib/owner";
import { createTrial, NewTrialSchema } from "@/lib/services";

// The Protocol Agent runs inside this request.
export const maxDuration = 120;

export async function POST(req: Request) {
  return handle(async () => {
    const input = NewTrialSchema.parse(await req.json());
    const trial = await createTrial(await ownerId(), input);
    return { id: trial.id };
  });
}
