export async function GET() {
  return Response.json({
    allowedEmails: process.env.ALLOWED_EMAILS,
    hasAuthSecret: !!process.env.AUTH_SECRET,
  });
}