"use client";

export default function Avatar({
  avatar,
  nickname,
  size = "normal",
}: {
  avatar: string | null;
  nickname: string;
  size?: "normal" | "large" | "small";
}) {
  return (
    <span className={`profile-avatar avatar-${size}`}>
      {avatar ? <img src={avatar} alt="" /> : <b>{nickname.slice(0, 1).toUpperCase()}</b>}
    </span>
  );
}
