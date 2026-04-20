// SplashScreen.jsx
import { useEffect, useState } from 'react';

export default function SplashScreen({ onFinish }) {
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setFadeOut(true);
      setTimeout(onFinish, 500); // Wait for fade out animation
    }, 2000); // Show splash for 2 seconds

    return () => clearTimeout(timer);
  }, [onFinish]);

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 z-50 transition-opacity duration-500 ${
        fadeOut ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <div className="text-center">
        {/* Animated Logo/Icon */}
        <div className="relative mb-8">
          <div className="w-24 h-24 mx-auto bg-white/10 rounded-3xl rotate-45 animate-pulse"></div>
          <div className="absolute inset-0 flex items-center justify-center">
            <svg
              className="w-12 h-12 text-white animate-bounce"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
        </div>

        {/* App Name */}
        <h1 className="text-4xl font-bold text-white mb-2 tracking-tight">
          LineOps
        </h1>

        {/* Company Name */}
        <div className="mb-8">
          <span className="text-gray-400 text-lg">by </span>
          <span className="text-white font-semibold text-lg">Skyrina</span>
        </div>

        {/* Loading Dots */}
        <div className="flex justify-center space-x-2 mb-12">
          <div className="w-2 h-2 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></div>
          <div className="w-2 h-2 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
          <div className="w-2 h-2 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
        </div>

        {/* Developed By */}
        <div className="absolute bottom-8 left-0 right-0">
          <p className="text-gray-500 text-sm">
            developed by <span className="text-gray-400 font-medium">Leonard Baiju</span>
          </p>
        </div>
      </div>
    </div>
  );
}