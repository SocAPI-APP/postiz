import React from 'react';

export const LogoTextComponent = () => {
  return (
    <div className="flex h-[36px] items-center gap-[8px]" aria-label="SocAPI">
      <img
        src="/socapi-icon.png"
        alt=""
        width={32}
        height={32}
        className="h-[32px] w-[32px] object-contain"
      />
      <span className="text-[26px] font-semibold leading-none tracking-[-0.5px]">
        SocAPI
      </span>
    </div>
  );
};
