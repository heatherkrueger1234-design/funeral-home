import { useState } from "react";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { useGetTodos, useCreateTodo, useUpdateTodo, useDeleteTodo } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { CheckSquare, Plus, Trash2, Check } from "lucide-react";
import { motion } from "framer-motion";

const categories = ["Estate", "Notifications", "Medical", "Funeral", "Personal", "Legal", "Financial", "Other"];

export default function Todos() {
  const { data: todos, refetch } = useGetTodos();
  const { mutate: createTodo, isPending } = useCreateTodo();
  const { mutate: updateTodo } = useUpdateTodo();
  const { mutate: deleteTodo } = useDeleteTodo();
  const { toast } = useToast();
  const [newText, setNewText] = useState("");
  const [newCategory, setNewCategory] = useState("Other");

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newText.trim()) return;
    createTodo({ data: { text: newText, completed: false, category: newCategory } }, {
      onSuccess: () => {
        setNewText("");
        refetch();
      }
    });
  };

  const toggle = (id: number, completed: boolean) => {
    updateTodo({ id, data: { text: todos?.find(t => t.id === id)?.text ?? "", completed: !completed } }, {
      onSuccess: () => refetch()
    });
  };

  const pending = todos?.filter(t => !t.completed) ?? [];
  const done = todos?.filter(t => t.completed) ?? [];

  return (
    <PageLayout>
      <PageHeader
        title="To-Do List"
        description="The practical tasks that come with losing someone. Take it one at a time."
      />

      <form onSubmit={handleAdd} className="glass-panel p-4 rounded-2xl flex gap-3 mb-8 flex-wrap">
        <Input value={newText} onChange={e => setNewText(e.target.value)} placeholder="Add a task..." className="flex-1 bg-background border-white/10 min-w-0" />
        <select value={newCategory} onChange={e => setNewCategory(e.target.value)}
          className="bg-background border border-white/10 rounded-xl px-3 py-2 text-sm text-foreground">
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <Button type="submit" disabled={isPending} className="bg-primary text-primary-foreground px-5">
          <Plus className="w-4 h-4" />
        </Button>
      </form>

      {!todos?.length ? (
        <EmptyState icon={CheckSquare} title="Nothing Yet" description="Add tasks like notifying family, handling estate details, or anything you need to remember." />
      ) : (
        <div className="space-y-8">
          {pending.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-primary/70 uppercase tracking-widest text-xs font-semibold">Remaining ({pending.length})</h3>
              {pending.map(todo => (
                <motion.div key={todo.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="glass-panel px-5 py-4 rounded-2xl flex items-center gap-4 group">
                  <button onClick={() => toggle(todo.id, todo.completed)}
                    className="w-6 h-6 rounded-full border-2 border-primary/40 hover:border-primary flex items-center justify-center flex-shrink-0 transition-all">
                  </button>
                  <div className="flex-1">
                    <p className="text-foreground">{todo.text}</p>
                    {todo.category && <span className="text-xs text-primary/60">{todo.category}</span>}
                  </div>
                  <Button variant="ghost" size="icon" className="opacity-70 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 text-destructive hover:bg-destructive/20 transition-all"
                    onClick={() => deleteTodo({ id: todo.id }, { onSuccess: () => refetch() })}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </motion.div>
              ))}
            </div>
          )}
          {done.length > 0 && (
            <div className="space-y-3 opacity-60">
              <h3 className="text-muted-foreground uppercase tracking-widest text-xs font-semibold">Completed ({done.length})</h3>
              {done.map(todo => (
                <motion.div key={todo.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="glass-panel px-5 py-4 rounded-2xl flex items-center gap-4 group">
                  <button onClick={() => toggle(todo.id, todo.completed)}
                    className="w-6 h-6 rounded-full bg-primary/30 border-2 border-primary flex items-center justify-center flex-shrink-0">
                    <Check className="w-3 h-3 text-primary" />
                  </button>
                  <div className="flex-1">
                    <p className="text-muted-foreground line-through">{todo.text}</p>
                    {todo.category && <span className="text-xs text-muted-foreground/60">{todo.category}</span>}
                  </div>
                  <Button variant="ghost" size="icon" className="opacity-70 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 text-destructive hover:bg-destructive/20 transition-all"
                    onClick={() => deleteTodo({ id: todo.id }, { onSuccess: () => refetch() })}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      )}
    </PageLayout>
  );
}
