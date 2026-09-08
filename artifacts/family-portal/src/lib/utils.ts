import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, parseISO } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return "";
  try {
    return format(parseISO(dateString), "MMMM do, yyyy");
  } catch {
    return dateString;
  }
}

export function formatDateTime(dateString: string | null | undefined): string {
  if (!dateString) return "";
  try {
    return format(parseISO(dateString), "MMMM do, yyyy 'at' h:mm a");
  } catch {
    return dateString;
  }
}
