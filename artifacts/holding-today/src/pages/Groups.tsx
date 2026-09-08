import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { Users, Heart, ExternalLink, Phone, Globe, BookOpen } from "lucide-react";
import { motion } from "framer-motion";

const resources = [
  {
    name: "The Compassionate Friends",
    description: "The oldest and largest support organization for families who have experienced the death of a child. Chapters worldwide, monthly meetings, online support.",
    url: "https://www.compassionatefriends.org",
    phone: "1-877-969-0010",
    type: "Organization",
    color: "border-rose-400/30 bg-rose-400/5"
  },
  {
    name: "Still Standing Magazine",
    description: "An online magazine and community specifically for parents who have experienced pregnancy or infant loss, or child loss at any age.",
    url: "https://stillstandingmag.com",
    type: "Online Community",
    color: "border-purple-400/30 bg-purple-400/5"
  },
  {
    name: "MISS Foundation",
    description: "Supporting families after the death of a child of any age. Offers counseling, advocacy, research, and community support.",
    url: "https://missfoundation.org",
    type: "Organization",
    color: "border-blue-400/30 bg-blue-400/5"
  },
  {
    name: "GriefShare",
    description: "Grief recovery support groups with thousands of local chapters. Video curriculum, workbook, and community for all types of loss.",
    url: "https://www.griefshare.org",
    type: "Support Groups",
    color: "border-teal-400/30 bg-teal-400/5"
  },
  {
    name: "Open to Hope",
    description: "Online community, podcasts, articles, and videos helping people find hope after loss. Founded by bereaved parents.",
    url: "https://www.opentohope.com",
    type: "Online Community",
    color: "border-amber-400/30 bg-amber-400/5"
  },
  {
    name: "National Alliance for Grieving Children",
    description: "Resources for bereaved children and those who support them, including a directory of children's grief support programs.",
    url: "https://childrengrieve.org",
    type: "Organization",
    color: "border-emerald-400/30 bg-emerald-400/5"
  },
  {
    name: "988 Suicide & Crisis Lifeline",
    description: "If you are in crisis or having thoughts of suicide, please reach out. Call or text 988. Available 24/7.",
    phone: "988",
    type: "Crisis Support",
    color: "border-red-400/30 bg-red-400/10"
  }
];

const groupTypes = [
  {
    title: "In-Person Support Groups",
    icon: Users,
    description: "Meeting face-to-face with other bereaved parents can provide a level of connection that is hard to find elsewhere. Seeing someone who has walked this path and is still standing is powerful medicine.",
    tips: ["Search for local chapters of The Compassionate Friends", "Ask your hospital's grief counselor for local groups", "Check funeral homes — many host or know of local groups", "Try a few different groups to find the right fit"]
  },
  {
    title: "Online Communities",
    icon: Globe,
    description: "When leaving the house feels impossible, online communities offer 24/7 connection with parents who truly understand. No judgment. No timeline. Just understanding.",
    tips: ["Facebook groups for bereaved parents", "Reddit communities like r/GriefSupport", "Discord servers for specific loss types", "Instagram communities using hashtags like #childloss"]
  },
  {
    title: "Individual Grief Therapy",
    icon: Heart,
    description: "A grief-specialized therapist provides one-on-one support. Look for therapists trained in complicated grief, EMDR for trauma, or those who specifically work with bereaved parents.",
    tips: ["Psychology Today's therapist finder (filter by grief)", "Your child's hospital may offer referrals", "EMDR practitioners for trauma-related grief", "Online therapy platforms like BetterHelp"]
  },
  {
    title: "Books & Written Resources",
    icon: BookOpen,
    description: "Many bereaved parents find comfort in reading about others' experiences. Knowing someone else has felt exactly what you feel can break the isolation of grief.",
    tips: ['"The Grieving Garden" — Cultivating Hope After Loss', '"Empty Cradle, Broken Heart" — Deborah Davis', '"Healing After Loss" — Martha Whitmore Hickman', '"When Will I Stop Hurting?" — June Cerza Kolf']
  }
];

export default function Groups() {
  return (
    <PageLayout>
      <PageHeader
        title="Grief Groups & Support"
        description="You do not have to walk this alone. Others have walked before you and will walk beside you."
      />

      <div className="mb-8 glass-panel p-6 rounded-3xl border border-primary/20 text-center">
        <Users className="w-8 h-8 text-primary mx-auto mb-3" />
        <p className="text-foreground/80 leading-relaxed">
          Research consistently shows that connection with others who have experienced similar loss is one of the most powerful parts of healing after losing a child. You deserve that support.
        </p>
      </div>

      <div className="space-y-8">
        <h2 className="text-primary/70 uppercase tracking-widest text-xs font-semibold">Types of Support</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {groupTypes.map((type, i) => {
            const Icon = type.icon;
            return (
              <motion.div key={type.title} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                className="glass-panel p-6 rounded-3xl">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <h3 className="font-display text-lg text-foreground">{type.title}</h3>
                </div>
                <p className="text-foreground/70 text-sm leading-relaxed mb-4">{type.description}</p>
                <ul className="space-y-1">
                  {type.tips.map(tip => (
                    <li key={tip} className="text-sm text-muted-foreground flex items-start gap-2">
                      <span className="text-primary mt-0.5">•</span> {tip}
                    </li>
                  ))}
                </ul>
              </motion.div>
            );
          })}
        </div>

        <h2 className="text-primary/70 uppercase tracking-widest text-xs font-semibold mt-8">Organizations & Resources</h2>
        <div className="space-y-4">
          {resources.map((resource, i) => (
            <motion.div key={resource.name} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
              className={`glass-panel p-5 rounded-2xl border ${resource.color}`}>
              <div className="flex justify-between items-start gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-foreground">{resource.name}</h3>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-muted-foreground">{resource.type}</span>
                  </div>
                  <p className="text-foreground/70 text-sm leading-relaxed">{resource.description}</p>
                  {resource.phone && (
                    <div className="flex items-center gap-1 mt-2 text-primary text-sm">
                      <Phone className="w-3 h-3" /> {resource.phone}
                    </div>
                  )}
                </div>
                {resource.url && (
                  <a href={resource.url} target="_blank" rel="noopener noreferrer"
                    className="flex-shrink-0 text-primary hover:text-primary/70 transition-colors">
                    <ExternalLink className="w-5 h-5" />
                  </a>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </PageLayout>
  );
}
