export default function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div
        className="w-32 aspect-square rounded-full relative flex justify-center items-center animate-[spin_3s_linear_infinite] z-40
          bg-[conic-gradient(var(--foreground)_0deg,var(--foreground)_300deg,transparent_270deg,transparent_360deg)]
          before:animate-[spin_2s_linear_infinite] before:absolute before:w-[60%] before:aspect-square before:rounded-full before:z-[80]
          before:bg-[conic-gradient(var(--foreground)_0deg,var(--foreground)_270deg,transparent_180deg,transparent_360deg)]
          after:absolute after:w-3/4 after:aspect-square after:rounded-full after:z-[60] after:animate-[spin_3s_linear_infinite]
          after:bg-[conic-gradient(var(--spinner-dark)_0deg,var(--spinner-dark)_180deg,transparent_180deg,transparent_360deg)]"
      >
        <span
          className="absolute w-[85%] aspect-square rounded-full z-[60] animate-[spin_5s_linear_infinite]
            bg-[conic-gradient(var(--spinner-light)_0deg,var(--spinner-light)_180deg,transparent_180deg,transparent_360deg)]"
        />
      </div>
    </div>
  );
}
