import LoginFormClient from './LoginFormClient';

export default function LoginPage() {
  return (
    <div
      className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100"
      style={{
        backgroundImage: "url('/store.jpg')",
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    >
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" />
      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-12">
        <LoginFormClient />
      </div>
    </div>
  );
}
