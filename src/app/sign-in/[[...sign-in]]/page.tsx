import { SignIn } from "@clerk/nextjs";

export default function Page() {
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <SignIn />
    </div>
  );
}
