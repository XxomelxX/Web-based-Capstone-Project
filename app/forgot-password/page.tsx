import ForgotPasswordClient from './ForgotPasswordClient';

export default function ForgotPasswordPage() {
  return (
    <div
      className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100"
    >
      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-12">
        <ForgotPasswordClient />
      </div>
    </div>
  );
}
