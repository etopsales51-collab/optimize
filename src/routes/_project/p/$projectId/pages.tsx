import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ExternalLink,
  Image as ImageIcon,
  Monitor,
  Plus,
  Save,
  Send,
  Smartphone,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type {
  OptimizePageDocument,
  PageImage,
  WordpressMediaItem,
} from "@/shared/pageEditor";
import {
  createPageDraft,
  getPageDraft,
  getPageEditorBootstrap,
  listPageDrafts,
  publishPageDraft,
  savePageDraft,
  searchWordpressMedia,
  validatePageDraft,
} from "@/serverFunctions/pageEditor";

export const Route = createFileRoute("/_project/p/$projectId/pages")({
  component: PageEditor,
});

function PageEditor() {
  const { projectId } = Route.useParams();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [document, setDocument] = useState<OptimizePageDocument | null>(null);
  const [baseline, setBaseline] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">(
    "desktop",
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [mediaTarget, setMediaTarget] = useState<"hero" | number | null>(null);

  const drafts = useQuery({
    queryKey: ["page-drafts", projectId],
    queryFn: () => listPageDrafts({ data: { projectId } }),
  });
  const bootstrap = useQuery({
    queryKey: ["page-editor-bootstrap", projectId],
    queryFn: () => getPageEditorBootstrap({ data: { projectId } }),
    retry: false,
  });
  const loaded = useQuery({
    queryKey: ["page-draft", projectId, selectedId],
    queryFn: () => getPageDraft({ data: { projectId, id: selectedId! } }),
    enabled: Boolean(selectedId),
  });

  useEffect(() => {
    if (!loaded.data) return;
    setDocument(loaded.data.document);
    setBaseline(JSON.stringify(loaded.data.document));
    setPreviewHtml(loaded.data.savedRenderedHtml ?? "");
    setErrors([]);
  }, [loaded.data]);

  const dirty = document ? JSON.stringify(document) !== baseline : false;
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const create = useMutation({
    mutationFn: () => {
      const suffix = Date.now().toString().slice(-6);
      return createPageDraft({
        data: {
          projectId,
          title: "New Optimize page",
          slug: `new-optimize-page-${suffix}`,
        },
      });
    },
    onSuccess: async (draft) => {
      await queryClient.invalidateQueries({
        queryKey: ["page-drafts", projectId],
      });
      setSelectedId(draft.id);
    },
    onError: (error) => toast.error(error.message),
  });
  const validate = useMutation({
    mutationFn: () =>
      validatePageDraft({ data: { projectId, document: document! } }),
    onSuccess: (result) => {
      setErrors(result.errors);
      setPreviewHtml(result.previewHtml ?? "");
      if (result.valid)
        toast.success("Page is valid and ready to save as a draft.");
    },
    onError: (error) => toast.error(error.message),
  });
  const save = useMutation({
    mutationFn: () =>
      savePageDraft({
        data: { projectId, id: selectedId!, document: document! },
      }),
    onSuccess: async (result) => {
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      setDocument(result.draft.document);
      setBaseline(JSON.stringify(result.draft.document));
      setPreviewHtml(result.draft.savedRenderedHtml ?? "");
      setErrors([]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["page-drafts", projectId] }),
        queryClient.invalidateQueries({
          queryKey: ["page-draft", projectId, selectedId],
        }),
      ]);
      toast.success("Saved to WordPress as a draft.");
      if (result.warning) toast.warning(result.warning);
    },
    onError: (error) => toast.error(error.message),
  });
  const publish = useMutation({
    mutationFn: () =>
      publishPageDraft({ data: { projectId, id: selectedId! } }),
    onSuccess: (result) =>
      result.ok ? toast.success("Page published.") : setErrors(result.errors),
    onError: (error) => toast.error(error.message),
  });

  const change = <K extends keyof OptimizePageDocument>(
    key: K,
    value: OptimizePageDocument[K],
  ) =>
    setDocument((current) =>
      current ? { ...current, [key]: value } : current,
    );
  const sectionChange = (
    index: number,
    patch: Partial<OptimizePageDocument["sections"][number]>,
  ) =>
    setDocument((current) =>
      current
        ? {
            ...current,
            sections: current.sections.map((section, i) =>
              i === index ? { ...section, ...patch } : section,
            ),
          }
        : current,
    );
  const chooseImage = (image: WordpressMediaItem) => {
    const selected: PageImage = {
      id: image.id,
      url: image.sourceUrl,
      alt: image.alt || image.title,
      caption: image.caption,
    };
    if (mediaTarget === "hero") change("heroImage", selected);
    else if (typeof mediaTarget === "number")
      sectionChange(mediaTarget, { image: selected });
    setMediaTarget(null);
  };
  const useDemoImages = () => {
    const demo = bootstrap.data?.demonstrationMedia;
    if (!demo?.hero || !demo.section2 || !document) return;
    change("heroImage", {
      id: demo.hero.id,
      url: demo.hero.sourceUrl,
      alt: demo.hero.alt || "ZKTeco SpeedFace V5",
      caption: demo.hero.caption,
    });
    sectionChange(1, {
      image: {
        id: demo.section2.id,
        url: demo.section2.sourceUrl,
        alt: demo.section2.alt || "ZKTeco F18",
        caption: demo.section2.caption,
      },
    });
  };

  return (
    <div className="h-full overflow-auto p-4 md:p-6">
      <div className="mx-auto max-w-[1600px] space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">WordPress Page Editor</h1>
            <p className="text-sm text-base-content/65">
              Optimize Page v1 · Edit → Validate → Save Draft → Preview →
              Explicit Publish
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn btn-sm"
              onClick={() => create.mutate()}
              disabled={create.isPending}
            >
              <Plus className="size-4" />
              New page
            </button>
            {document && (
              <>
                <button
                  className="btn btn-sm"
                  onClick={() => validate.mutate()}
                  disabled={validate.isPending}
                >
                  <CheckCircle2 className="size-4" />
                  Validate
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => save.mutate()}
                  disabled={save.isPending}
                >
                  <Save className="size-4" />
                  Save draft
                </button>
                <button
                  className="btn btn-error btn-outline btn-sm"
                  onClick={() => publish.mutate()}
                  disabled={
                    publish.isPending || loaded.data?.status === "publish"
                  }
                >
                  <Send className="size-4" />
                  Publish
                </button>
              </>
            )}
          </div>
        </header>
        {bootstrap.error && (
          <div className="alert alert-error">{bootstrap.error.message}</div>
        )}
        {bootstrap.data && (
          <div className="text-xs text-base-content/60">
            Connected blueprint #{bootstrap.data.blueprint.id} and example draft
            #{bootstrap.data.example.id}.{" "}
            {bootstrap.data.faqSchemaPresent
              ? "Existing FAQ schema generator detected; the editor will not add another."
              : "No FAQ schema generator was detected in the scoped source."}
          </div>
        )}
        <div className="grid gap-4 xl:grid-cols-[240px_minmax(420px,1fr)_minmax(360px,1fr)]">
          <aside className="rounded-box border border-base-300 bg-base-100 p-3">
            <div className="mb-2 text-sm font-semibold">Pages</div>
            <div className="space-y-1">
              {drafts.data?.map((item) => (
                <button
                  key={item.id}
                  className={`w-full rounded p-2 text-left text-sm ${selectedId === item.id ? "bg-primary text-primary-content" : "hover:bg-base-200"}`}
                  onClick={() => {
                    if (!dirty || window.confirm("Discard unsaved changes?"))
                      setSelectedId(item.id);
                  }}
                >
                  <span className="block truncate font-medium">
                    {item.title}
                  </span>
                  <span className="block truncate text-xs opacity-70">
                    /{item.slug} · {item.status}
                  </span>
                </button>
              ))}
            </div>
          </aside>
          <main className="space-y-4 rounded-box border border-base-300 bg-base-100 p-4">
            {!document ? (
              <div className="py-20 text-center text-base-content/55">
                Choose a page or create a new draft.
              </div>
            ) : (
              <>
                {dirty && (
                  <div className="alert alert-warning py-2 text-sm">
                    Unsaved changes
                  </div>
                )}
                {errors.length > 0 && (
                  <div className="alert alert-error block">
                    <strong>Fix before saving</strong>
                    <ul className="mt-1 list-disc pl-5 text-sm">
                      {errors.map((error) => (
                        <li key={error}>{error}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <Field label="WordPress title">
                  <input
                    className="input input-bordered w-full"
                    value={document.title}
                    onChange={(e) => change("title", e.target.value)}
                  />
                </Field>
                <Field label="Slug">
                  <input
                    className="input input-bordered w-full"
                    value={document.slug}
                    onChange={(e) =>
                      change(
                        "slug",
                        e.target.value
                          .toLowerCase()
                          .replace(/[^a-z0-9-]+/g, "-")
                          .replace(/^-+|-+$/g, ""),
                      )
                    }
                  />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="SEO title">
                    <input
                      className="input input-bordered w-full"
                      value={document.seoTitle}
                      onChange={(e) => change("seoTitle", e.target.value)}
                    />
                  </Field>
                  <Field label="Focus keyword">
                    <input
                      className="input input-bordered w-full"
                      value={document.focusKeyword}
                      onChange={(e) => change("focusKeyword", e.target.value)}
                    />
                  </Field>
                </div>
                <Field label="Meta description">
                  <textarea
                    className="textarea textarea-bordered w-full"
                    value={document.metaDescription}
                    onChange={(e) => change("metaDescription", e.target.value)}
                  />
                </Field>
                <Field label="H1 · slot-h1">
                  <input
                    className="input input-bordered w-full"
                    value={document.h1}
                    onChange={(e) => change("h1", e.target.value)}
                  />
                </Field>
                <Field
                  label="Introduction · slot-intro"
                  hint="Basic HTML for paragraphs, links, lists and emphasis is supported."
                >
                  <textarea
                    className="textarea textarea-bordered min-h-28 w-full"
                    value={document.intro}
                    onChange={(e) => change("intro", e.target.value)}
                  />
                </Field>
                <ImageField
                  label="Hero image · slot-hero-image (optional)"
                  image={document.heroImage}
                  onPick={() => setMediaTarget("hero")}
                  onRemove={() => change("heroImage", null)}
                  onAlt={(alt) =>
                    document.heroImage &&
                    change("heroImage", { ...document.heroImage, alt })
                  }
                />
                <button
                  className="btn btn-xs btn-ghost"
                  onClick={useDemoImages}
                  disabled={!bootstrap.data?.demonstrationMedia.hero}
                >
                  Use requested demo images (media #134 and #112)
                </button>
                <Field label="Summary · slot-summary (3–5 points)">
                  {document.summary.map((point, index) => (
                    <div className="mb-2 flex gap-2" key={index}>
                      <input
                        className="input input-bordered input-sm flex-1"
                        value={point}
                        onChange={(e) =>
                          change(
                            "summary",
                            document.summary.map((item, i) =>
                              i === index ? e.target.value : item,
                            ),
                          )
                        }
                      />
                      {document.summary.length > 3 && (
                        <button
                          className="btn btn-square btn-ghost btn-sm"
                          onClick={() =>
                            change(
                              "summary",
                              document.summary.filter((_, i) => i !== index),
                            )
                          }
                        >
                          <X className="size-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  {document.summary.length < 5 && (
                    <button
                      className="btn btn-xs"
                      onClick={() =>
                        change("summary", [...document.summary, ""])
                      }
                    >
                      Add point
                    </button>
                  )}
                </Field>
                {document.sections.map((section, index) => (
                  <section
                    className="rounded-box border border-base-300 p-3"
                    key={index}
                  >
                    <h2 className="mb-3 font-semibold">
                      Section {index + 1}
                      {index >= 4 ? " (optional)" : ""} · slot-section-
                      {index + 1}
                    </h2>
                    <Field label="H2 heading">
                      <input
                        className="input input-bordered w-full"
                        value={section.heading}
                        onChange={(e) =>
                          sectionChange(index, { heading: e.target.value })
                        }
                      />
                    </Field>
                    <Field
                      label="Body"
                      hint="Paragraphs and lists only; headings are rejected."
                    >
                      <textarea
                        className="textarea textarea-bordered min-h-32 w-full"
                        value={section.body}
                        onChange={(e) =>
                          sectionChange(index, { body: e.target.value })
                        }
                      />
                    </Field>
                    <ImageField
                      label="Image (optional)"
                      image={section.image}
                      onPick={() => setMediaTarget(index)}
                      onRemove={() => sectionChange(index, { image: null })}
                      onAlt={(alt) =>
                        section.image &&
                        sectionChange(index, {
                          image: { ...section.image, alt },
                        })
                      }
                    />
                  </section>
                ))}
                <TableEditor document={document} change={change} />
                <FaqEditor document={document} change={change} />
                <Field label="Call to action · slot-cta (optional)">
                  <textarea
                    className="textarea textarea-bordered w-full"
                    value={document.cta}
                    onChange={(e) => change("cta", e.target.value)}
                  />
                </Field>
              </>
            )}
          </main>
          <aside className="min-w-0 rounded-box border border-base-300 bg-base-100 p-3">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="font-semibold">App preview</div>
                <div className="text-xs text-base-content/55">
                  Validate to refresh
                </div>
              </div>
              <div className="join">
                <button
                  className={`btn btn-xs join-item ${previewMode === "desktop" ? "btn-active" : ""}`}
                  onClick={() => setPreviewMode("desktop")}
                >
                  <Monitor className="size-3" />
                </button>
                <button
                  className={`btn btn-xs join-item ${previewMode === "mobile" ? "btn-active" : ""}`}
                  onClick={() => setPreviewMode("mobile")}
                >
                  <Smartphone className="size-3" />
                </button>
              </div>
            </div>
            <div
              className={`mx-auto overflow-hidden rounded border bg-white text-black transition-all ${previewMode === "mobile" ? "max-w-[390px]" : "w-full"}`}
            >
              <article
                className="optimize-page-preview p-5"
                dangerouslySetInnerHTML={{
                  __html:
                    previewHtml ||
                    "<p>Validate the page to generate an app preview.</p>",
                }}
              />
            </div>
            {loaded.data?.previewUrl && (
              <div className="mt-4 rounded-box border border-base-300 p-3">
                <div className="font-semibold">
                  Saved WordPress draft preview
                </div>
                <p className="my-2 text-xs text-base-content/60">
                  This opens WordPress’s draft preview. WordPress may ask you to
                  log in.
                </p>
                <a
                  className="btn btn-sm"
                  href={loaded.data.previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="size-4" />
                  Open WordPress Preview
                </a>
              </div>
            )}
          </aside>
        </div>
      </div>
      {mediaTarget !== null && (
        <MediaPicker
          projectId={projectId}
          onChoose={chooseImage}
          onClose={() => setMediaTarget(null)}
        />
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {hint && (
        <span className="mt-1 block text-xs text-base-content/55">{hint}</span>
      )}
    </label>
  );
}

function ImageField({
  label,
  image,
  onPick,
  onRemove,
  onAlt,
}: {
  label: string;
  image: PageImage | null;
  onPick: () => void;
  onRemove: () => void;
  onAlt: (alt: string) => void;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1 text-sm font-medium">{label}</div>
      {image ? (
        <div className="flex gap-3 rounded border border-base-300 p-2">
          <img
            src={image.url}
            alt={image.alt}
            className="h-24 w-32 object-contain"
          />
          <div className="min-w-0 flex-1">
            <input
              className="input input-bordered input-sm w-full"
              value={image.alt}
              placeholder="Meaningful alt text"
              onChange={(e) => onAlt(e.target.value)}
            />
            <div className="mt-2 flex gap-2">
              <button className="btn btn-xs" onClick={onPick}>
                Change
              </button>
              <button className="btn btn-xs btn-ghost" onClick={onRemove}>
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button className="btn btn-sm" onClick={onPick}>
          <ImageIcon className="size-4" />
          Choose from WordPress
        </button>
      )}
    </div>
  );
}

function TableEditor({
  document,
  change,
}: {
  document: OptimizePageDocument;
  change: <K extends keyof OptimizePageDocument>(
    key: K,
    value: OptimizePageDocument[K],
  ) => void;
}) {
  const table = document.table;
  const enabled = table.columns.length > 0;
  const set = (patch: Partial<typeof table>) =>
    change("table", { ...table, ...patch });
  return (
    <section className="rounded-box border border-base-300 p-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">
          Comparison table · slot-table (optional)
        </h2>
        <input
          type="checkbox"
          className="toggle toggle-sm"
          checked={enabled}
          onChange={(e) =>
            set(
              e.target.checked
                ? { columns: ["Option", "Details"], rows: [["", ""]] }
                : { heading: "", columns: [], rows: [] },
            )
          }
        />
      </div>
      {enabled && (
        <div className="mt-3 space-y-2">
          <input
            className="input input-bordered input-sm w-full"
            placeholder="Optional table H2"
            value={table.heading}
            onChange={(e) => set({ heading: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-2">
            {table.columns.map((cell, i) => (
              <input
                key={i}
                className="input input-bordered input-sm"
                value={cell}
                onChange={(e) =>
                  set({
                    columns: table.columns.map((value, j) =>
                      j === i ? e.target.value : value,
                    ),
                  })
                }
              />
            ))}
          </div>
          {table.rows.map((row, ri) => (
            <div className="grid grid-cols-2 gap-2" key={ri}>
              {row.map((cell, ci) => (
                <input
                  key={ci}
                  className="input input-bordered input-sm"
                  value={cell}
                  onChange={(e) =>
                    set({
                      rows: table.rows.map((r, rj) =>
                        rj === ri
                          ? r.map((value, cj) =>
                              cj === ci ? e.target.value : value,
                            )
                          : r,
                      ),
                    })
                  }
                />
              ))}
            </div>
          ))}
          <button
            className="btn btn-xs"
            onClick={() =>
              set({ rows: [...table.rows, table.columns.map(() => "")] })
            }
          >
            Add row
          </button>
        </div>
      )}
    </section>
  );
}

function FaqEditor({
  document,
  change,
}: {
  document: OptimizePageDocument;
  change: <K extends keyof OptimizePageDocument>(
    key: K,
    value: OptimizePageDocument[K],
  ) => void;
}) {
  return (
    <section className="rounded-box border border-base-300 p-3">
      <h2 className="mb-3 font-semibold">FAQ · slot-faq (optional)</h2>
      <input
        className="input input-bordered input-sm mb-2 w-full"
        placeholder="FAQ section H2"
        value={document.faqHeading}
        onChange={(e) => change("faqHeading", e.target.value)}
      />
      {document.faqs.map((faq, index) => (
        <div className="mb-2 rounded border border-base-300 p-2" key={index}>
          <input
            className="input input-bordered input-sm mb-2 w-full"
            placeholder="Question (H3)"
            value={faq.question}
            onChange={(e) =>
              change(
                "faqs",
                document.faqs.map((item, i) =>
                  i === index ? { ...item, question: e.target.value } : item,
                ),
              )
            }
          />
          <textarea
            className="textarea textarea-bordered textarea-sm w-full"
            placeholder="Answer"
            value={faq.answer}
            onChange={(e) =>
              change(
                "faqs",
                document.faqs.map((item, i) =>
                  i === index ? { ...item, answer: e.target.value } : item,
                ),
              )
            }
          />
          <button
            className="btn btn-xs btn-ghost mt-1"
            onClick={() =>
              change(
                "faqs",
                document.faqs.filter((_, i) => i !== index),
              )
            }
          >
            Remove
          </button>
        </div>
      ))}
      <button
        className="btn btn-xs"
        onClick={() =>
          change("faqs", [...document.faqs, { question: "", answer: "" }])
        }
      >
        Add FAQ
      </button>
    </section>
  );
}

function MediaPicker({
  projectId,
  onChoose,
  onClose,
}: {
  projectId: string;
  onChoose: (item: WordpressMediaItem) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const queryKey = useMemo(
    () => ["wordpress-media", projectId, search],
    [projectId, search],
  );
  const media = useQuery({
    queryKey,
    queryFn: () => searchWordpressMedia({ data: { projectId, search } }),
  });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[85vh] w-full max-w-4xl overflow-auto rounded-box bg-base-100 p-4">
        <div className="mb-3 flex gap-2">
          <input
            className="input input-bordered flex-1"
            placeholder="Search WordPress media"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn btn-square" onClick={onClose}>
            <X />
          </button>
        </div>
        {media.error && (
          <div className="alert alert-error">{media.error.message}</div>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {media.data?.map((item) => (
            <button
              className="rounded border border-base-300 p-2 text-left hover:border-primary"
              key={item.id}
              onClick={() => onChoose(item)}
            >
              <img
                src={item.sourceUrl}
                alt={item.alt || item.title}
                className="h-32 w-full object-contain"
              />
              <span className="mt-1 block truncate text-xs">
                #{item.id} {item.title}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
