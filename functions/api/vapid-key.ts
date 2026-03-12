interface Env {
  VAPID_PUBLIC_KEY: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  return Response.json({ publicKey: context.env.VAPID_PUBLIC_KEY });
};
