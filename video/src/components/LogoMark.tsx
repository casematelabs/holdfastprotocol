import React from "react";
import { THEME } from "../theme";

type LogoMarkProps = {
  size?: number;
  color?: string;
  showWordmark?: boolean;
};

export const LogoMark: React.FC<LogoMarkProps> = ({
  size = 160,
  color = THEME.accent,
  showWordmark = false,
}) => {
  const markOnly = !showWordmark;
  const viewBox = markOnly ? "0 0 28 41" : "0 0 160 52";
  const aspect = markOnly ? 28 / 41 : 160 / 52;
  const width = size;
  const height = width / aspect;

  return (
    <svg
      width={width}
      height={height}
      viewBox={viewBox}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Shield */}
      <path
        d={
          markOnly
            ? "M14 0L0 3.5V14C0 22.3 4.8 29.7 14 33C23.2 29.7 28 22.3 28 14V3.5L14 0Z"
            : "M14 4L4 7.5V18C4 26.3 8.8 33.7 14 37C19.2 33.7 24 26.3 24 18V7.5L14 4Z"
        }
        stroke={color}
        strokeWidth="1.8"
        fill={`${color}1A`}
      />
      {/* Lock body */}
      <rect
        x={markOnly ? 5.5 : 9.5}
        y={markOnly ? 16 : 20}
        width="9"
        height="8"
        stroke={color}
        strokeWidth="1.6"
        fill="none"
      />
      {/* Lock shackle */}
      <path
        d={
          markOnly
            ? "M8 16V13C8 11.3 9.3 10 11 10"
            : "M12 20V17C12 15.3 13.3 14 15 14"
        }
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="square"
        fill="none"
      />
      {/* Lock dot */}
      <circle
        cx={markOnly ? 10 : 14}
        cy={markOnly ? 20 : 24}
        r="1.2"
        fill={color}
      />
      {!markOnly && (
        <>
          {/* Chain link left */}
          <rect
            x="27"
            y="20"
            width="7"
            height="4"
            rx="2"
            stroke={color}
            strokeWidth="1.4"
            fill="none"
          />
          {/* Chain link right */}
          <rect
            x="32"
            y="20"
            width="7"
            height="4"
            rx="2"
            stroke={color}
            strokeWidth="1.4"
            fill="none"
          />
          {/* Wordmark */}
          <text
            x="44"
            y="28"
            fontFamily="'Inter','Helvetica Neue',Arial,sans-serif"
            fontSize="20"
            fontWeight="800"
            letterSpacing="-0.04em"
            fill={THEME.textPrimary}
          >
            Holdfast
          </text>
        </>
      )}
    </svg>
  );
};
