import LoginFormClient from './LoginFormClient';

export default function LoginPage() {
  return (
    <div className="min-h-screen flex bg-white overflow-hidden">
      {/* Left Side — Dark Green + White Wave */}
      <div className="hidden lg:flex lg:w-1/2 relative bg-[#1a3a2a]">
        {/* White wavy shape */}
        <svg
          className="absolute right-0 top-0 h-full text-white"
          viewBox="0 0 300 900"
          preserveAspectRatio="none"
          style={{ width: '180px' }}
        >
          <path
            d="M300,0 C200,100 80,150 100,300 C120,450 250,500 200,650 C150,800 280,850 300,900 L300,0 Z"
            fill="currentColor"
          />
        </svg>

        {/* Decorative circles */}
        <div className="absolute top-1/4 left-8 w-4 h-4 rounded-full bg-[#3a6a5a]/40" />
        <div className="absolute top-1/2 left-16 w-3 h-3 rounded-full bg-[#3a6a5a]/30" />
        <div className="absolute bottom-1/4 left-12 w-5 h-5 rounded-full bg-[#3a6a5a]/25" />

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-center px-12 py-16 w-full">
          {/* Title */}
          <h1
            className="text-4xl font-bold text-white leading-snug mb-4 tracking-wide"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            Web-Based POS<br />
            Inventory and Sales<br />
            System for Sari-Sari Store
          </h1>

          {/* Blue separator line */}
          <div className="w-16 h-0.5 bg-[#6b9e8e] rounded-full mb-5" />

          {/* Subtitle */}
          <p
            className="text-white/70 text-sm leading-relaxed italic"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            Simple, efficient, and reliable.<br />
            Manage your store better every day.
          </p>
        </div>
      </div>

      {/* Right Side — Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center bg-white px-8">
        <LoginFormClient />
      </div>
    </div>
  );
}
