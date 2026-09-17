import { formatDayFirst } from '@/lib/search.ts';

/**
 * The eight approved frames, as one component.
 *
 * Config rather than eight blocks of JSX. The designs differ in their
 * mouldings, their grounds and where the three slots sit, but they share a
 * skeleton — wall, moulding, liner, mount, slots — and writing that skeleton
 * once is what keeps a change to the safe zone from having to be made eight
 * times and missed twice.
 *
 * Everything is sized in percentages against an aspect-ratio box, so one
 * template serves the 120px chip in the picker, the preview beside it and
 * whatever a print sheet eventually needs, from the same source.
 *
 * The note slot is 2.2:1 in every design. Indian notes run 2.15–2.27:1, so a
 * note sits inside that aperture with its serial, denomination, signature and
 * security features all clear of the frame's edge — which is the one
 * requirement none of these may break.
 */

export const NOTE_ASPECT = 2.2;

export interface FrameContent {
  /** The listing's photograph. Null while the buyer is still choosing. */
  noteImageUrl?: string | null;
  /** The buyer's photograph, served from the authenticated gift route. */
  photoUrl?: string | null;
  message?: string | null;
  recipient?: string | null;
  sender?: string | null;
  /** ISO. Rendered day-first, like every other date on the site. */
  occasionOn?: string | null;
}

type Ground = 'dark' | 'light';
type PhotoShape = 'square' | 'portrait' | 'circle';
/** Where the photo and message sit relative to the note. */
type Layout = 'photo-beside-message' | 'message-then-photo' | 'stacked' | 'three-across' | 'side-rails';

interface Design {
  code: string;
  name: string;
  orientation: 'portrait' | 'landscape';
  ground: Ground;
  layout: Layout;
  photoShape: PhotoShape;
  /** The outer moulding. */
  moulding: string;
  /** The thin liner between moulding and mount, if the design has one. */
  liner: string | null;
  linerWidth: number;
  /** The mount the note is laid on. */
  mount: string;
  mouldingWidth: number;
  /** A cyan wash rising off the base, on the designs that use one. */
  uplight: boolean;
  /** The engraved grid, on Future Heritage only. */
  grid: boolean;
}

const NAVY = '#071A2B';

export const DESIGNS: readonly Design[] = [
  {
    code: 'royal-navy',
    name: 'Royal Navy',
    orientation: 'portrait',
    ground: 'dark',
    layout: 'photo-beside-message',
    photoShape: 'square',
    moulding:
      'linear-gradient(145deg,#1d4f7a 0%,#0d2b46 22%,#071A2B 52%,#0a2238 78%,#16406a 100%)',
    liner: 'linear-gradient(160deg,#20C4F4 0%,#0B5CFF 45%,#062a4a 100%)',
    linerWidth: 0.7,
    mount: 'linear-gradient(180deg,#0a2439 0%,#071A2B 60%,#061626 100%)',
    mouldingWidth: 4.2,
    uplight: false,
    grid: false,
  },
  {
    code: 'heritage-blue',
    name: 'Heritage Blue',
    orientation: 'portrait',
    ground: 'light',
    layout: 'message-then-photo',
    photoShape: 'square',
    moulding: 'linear-gradient(150deg,#0f3252 0%,#071A2B 40%,#071A2B 66%,#0c2946 100%)',
    liner: 'linear-gradient(180deg,#DDE3EA 0%,#F5F8FC 12%,#DDE3EA 100%)',
    linerWidth: 0.9,
    mount: '#F5F8FC',
    mouldingWidth: 5.4,
    uplight: false,
    grid: false,
  },
  {
    code: 'electric-blue',
    name: 'Electric Blue Luxury',
    orientation: 'landscape',
    ground: 'dark',
    layout: 'side-rails',
    photoShape: 'square',
    moulding:
      'linear-gradient(135deg,#1769FF 0%,#0B5CFF 18%,#071A2B 46%,#071A2B 62%,#0B5CFF 88%,#20C4F4 100%)',
    liner: null,
    linerWidth: 0,
    mount: 'linear-gradient(180deg,#0a2337 0%,#071A2B 70%,#061523 100%)',
    mouldingWidth: 2.4,
    uplight: false,
    grid: false,
  },
  {
    code: 'royal-gallery',
    name: 'Royal Gallery',
    orientation: 'portrait',
    ground: 'dark',
    layout: 'stacked',
    photoShape: 'circle',
    moulding:
      'linear-gradient(135deg,#2a6ea8 0%,#10375a 16%,#071A2B 42%,#071A2B 60%,#0f3457 84%,#2a6ea8 100%)',
    liner: 'linear-gradient(180deg,#0a2946 0%,#061a2c 100%)',
    linerWidth: 1.4,
    mount: 'linear-gradient(180deg,#08243b 0%,#071A2B 72%,#051420 100%)',
    mouldingWidth: 6.8,
    uplight: true,
    grid: false,
  },
  {
    code: 'minimal-white',
    name: 'Minimal White Luxury',
    orientation: 'portrait',
    ground: 'light',
    layout: 'photo-beside-message',
    photoShape: 'portrait',
    moulding: 'linear-gradient(150deg,#123a5e 0%,#071A2B 55%,#0b2540 100%)',
    liner: '#20C4F4',
    linerWidth: 0.25,
    mount: '#FFFFFF',
    mouldingWidth: 2.9,
    uplight: false,
    grid: false,
  },
  {
    code: 'executive',
    name: 'Executive Collection',
    orientation: 'landscape',
    ground: 'light',
    layout: 'three-across',
    photoShape: 'square',
    moulding: 'linear-gradient(160deg,#16456e 0%,#071A2B 38%,#071A2B 66%,#123c61 100%)',
    liner: 'linear-gradient(90deg,#0B5CFF 0%,#20C4F4 50%,#0B5CFF 100%)',
    linerWidth: 0.4,
    mount: 'linear-gradient(180deg,#F5F8FC 0%,#FFFFFF 100%)',
    mouldingWidth: 2.9,
    uplight: false,
    grid: false,
  },
  {
    code: 'signature',
    name: 'Signature Edition',
    orientation: 'portrait',
    ground: 'dark',
    layout: 'stacked',
    photoShape: 'square',
    moulding:
      'linear-gradient(140deg,#3b84c4 0%,#10395d 14%,#071A2B 40%,#071A2B 62%,#10395d 88%,#3b84c4 100%)',
    liner: 'linear-gradient(180deg,#20C4F4 0%,#0B5CFF 50%,#20C4F4 100%)',
    linerWidth: 0.3,
    mount: 'linear-gradient(180deg,#082137 0%,#071A2B 70%,#05131f 100%)',
    mouldingWidth: 5.2,
    uplight: false,
    grid: false,
  },
  {
    code: 'future-heritage',
    name: 'Future Heritage',
    orientation: 'landscape',
    ground: 'dark',
    layout: 'side-rails',
    photoShape: 'square',
    moulding: 'linear-gradient(150deg,#10395d 0%,#071A2B 42%,#071A2B 64%,#0e3355 100%)',
    liner: null,
    linerWidth: 0,
    mount: '#061726',
    mouldingWidth: 2.4,
    uplight: false,
    grid: true,
  },
];

export function findDesign(code: string): Design | undefined {
  return DESIGNS.find((d) => d.code === code);
}

/** An empty slot says what belongs in it; a filled one shows the thing. */
function Slot({
  label,
  hint,
  filled,
  ground,
  circle = false,
  style,
  children,
}: {
  label: string;
  hint?: string;
  filled: boolean;
  ground: Ground;
  circle?: boolean;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}) {
  const ink = ground === 'dark' ? '#F5F8FC' : '#101828';
  const dim = '#667085';
  const edge = ground === 'dark' ? 'rgba(32,196,244,.55)' : '#DDE3EA';

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '2%',
        overflow: 'hidden',
        border: filled ? `1px solid ${edge}` : `1px dashed ${edge}`,
        borderRadius: circle ? '50%' : 2,
        background: ground === 'dark' ? 'rgba(255,255,255,.03)' : '#FFFFFF',
        ...style,
      }}
    >
      {filled ? (
        children
      ) : (
        <>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'clamp(7px, 1.6cqw, 12px)',
              letterSpacing: '.3em',
              color: ink,
            }}
          >
            {label}
          </span>
          {hint !== undefined && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'clamp(5px, 1.1cqw, 9px)',
                letterSpacing: '.1em',
                color: dim,
                textAlign: 'center',
              }}
            >
              {hint}
            </span>
          )}
        </>
      )}
    </div>
  );
}

/**
 * One frame, at whatever width its container gives it.
 *
 * `cqw` units throughout, so the type inside scales with the frame rather
 * than with the page — the same template has to read at 120px in a picker and
 * at 600px in a preview.
 */
export function FrameTemplate({
  code,
  content = {},
  className,
}: {
  code: string;
  content?: FrameContent;
  className?: string;
}) {
  const d = findDesign(code);
  if (d === undefined) return null;

  const { noteImageUrl, photoUrl, message, recipient, sender, occasionOn } = content;
  const ink = d.ground === 'dark' ? '#F5F8FC' : '#101828';
  const hasMessage =
    (message ?? '') !== '' || (recipient ?? '') !== '' || (sender ?? '') !== '';

  const note = (
    <Slot
      label="NOTE"
      hint="2.2 : 1"
      filled={noteImageUrl != null}
      ground={d.ground}
      style={{ width: '100%', aspectRatio: `${NOTE_ASPECT} / 1` }}
    >
      {noteImageUrl != null && (
        <img
          src={noteImageUrl}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      )}
    </Slot>
  );

  const photo = (
    <Slot
      label="PHOTO"
      filled={photoUrl != null}
      ground={d.ground}
      circle={d.photoShape === 'circle'}
      style={{
        aspectRatio: d.photoShape === 'portrait' ? '3 / 4' : '1 / 1',
        ...(d.photoShape === 'circle' ? { borderRadius: '50%' } : {}),
      }}
    >
      {photoUrl != null && (
        <img
          src={photoUrl}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
    </Slot>
  );

  const messageSlot = (
    <Slot
      label="MESSAGE"
      hint="name · message · date"
      filled={hasMessage}
      ground={d.ground}
      style={{ flex: 1, minHeight: 0, padding: '4%' }}
    >
      {hasMessage && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '4%',
            textAlign: 'center',
            color: ink,
          }}
        >
          {(recipient ?? '') !== '' && (
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(8px,2cqw,18px)' }}>
              {recipient}
            </span>
          )}
          {(message ?? '') !== '' && (
            <span
              style={{
                fontFamily: 'var(--font-listing)',
                fontSize: 'clamp(6px,1.4cqw,13px)',
                lineHeight: 1.5,
                whiteSpace: 'pre-line',
              }}
            >
              {message}
            </span>
          )}
          {((sender ?? '') !== '' || (occasionOn ?? '') !== '') && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'clamp(5px,1.1cqw,10px)',
                letterSpacing: '.12em',
                color: '#667085',
              }}
            >
              {sender}
              {(sender ?? '') !== '' && (occasionOn ?? '') !== '' && ' · '}
              {(occasionOn ?? '') !== '' && formatDayFirst(occasionOn!)}
            </span>
          )}
        </div>
      )}
    </Slot>
  );

  const wordmark = (
    <span
      style={{
        fontFamily: 'var(--font-display)',
        fontSize: 'clamp(6px,1.3cqw,12px)',
        letterSpacing: '.34em',
        color: d.ground === 'dark' ? '#20C4F4' : NAVY,
        textAlign: 'center',
      }}
    >
      RAREMINTING
    </span>
  );

  /** The three slots, arranged as this design arranges them. */
  const body = (() => {
    switch (d.layout) {
      case 'side-rails':
        return (
          <div style={{ display: 'flex', gap: '3%', flex: 1, minHeight: 0 }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>{note}</div>
            <div style={{ width: '22%', display: 'flex', flexDirection: 'column', gap: '5%' }}>
              {photo}
              {messageSlot}
            </div>
          </div>
        );
      case 'three-across':
        return (
          <div style={{ display: 'flex', gap: '3%', flex: 1, minHeight: 0 }}>
            <div style={{ flex: 1.9, display: 'flex', alignItems: 'center' }}>{note}</div>
            <div style={{ width: '18%', display: 'flex' }}>{photo}</div>
            <div style={{ width: '22%', display: 'flex' }}>{messageSlot}</div>
          </div>
        );
      case 'message-then-photo':
        return (
          <>
            {note}
            {messageSlot}
            <div style={{ display: 'flex', gap: '4%', alignItems: 'flex-end' }}>
              <div style={{ width: '26%' }}>{photo}</div>
              <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>{wordmark}</div>
            </div>
          </>
        );
      case 'stacked':
        return (
          <>
            {note}
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <div style={{ width: '34%' }}>{photo}</div>
            </div>
            {messageSlot}
            {wordmark}
          </>
        );
      default:
        return (
          <>
            {note}
            <div style={{ display: 'flex', gap: '4%', flex: 1, minHeight: 0 }}>
              <div style={{ width: '32%' }}>{photo}</div>
              {messageSlot}
            </div>
            {wordmark}
          </>
        );
    }
  })();

  const isPortrait = d.orientation === 'portrait';

  return (
    <div
      className={className}
      style={{
        containerType: 'inline-size',
        aspectRatio: isPortrait ? '7 / 10' : '3 / 2',
        padding: `${d.mouldingWidth}%`,
        background: d.moulding,
        boxShadow:
          '0 1px 0 rgba(255,255,255,.22) inset, 0 -1px 0 rgba(0,0,0,.55) inset,' +
          ' 0 12px 30px -10px rgba(0,0,0,.55)',
      }}
    >
      <div
        style={{
          height: '100%',
          padding: d.liner === null ? 0 : `${d.linerWidth}%`,
          background: d.liner ?? 'transparent',
        }}
      >
        <div
          style={{
            position: 'relative',
            height: '100%',
            boxSizing: 'border-box',
            padding: '5%',
            display: 'flex',
            flexDirection: 'column',
            gap: '3.5%',
            background: d.mount,
            overflow: 'hidden',
          }}
        >
          {/* A faint engraved grid — the "data" reading on Future Heritage. */}
          {d.grid && (
            <div
              aria-hidden
              style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                opacity: 0.5,
                backgroundImage:
                  'repeating-linear-gradient(0deg,rgba(32,196,244,.09) 0 1px,transparent 1px 34px),' +
                  'repeating-linear-gradient(90deg,rgba(32,196,244,.09) 0 1px,transparent 1px 34px)',
              }}
            />
          )}

          {/* Cyan wash rising off the base, on Royal Gallery. */}
          {d.uplight && (
            <div
              aria-hidden
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                height: '28%',
                pointerEvents: 'none',
                background: 'linear-gradient(0deg,rgba(32,196,244,.16) 0%,transparent 100%)',
              }}
            />
          )}

          {/* The glass. One diagonal sheet, faint enough never to fight what
              is under it — a reflection that obscures the note defeats the
              point of the frame. */}
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              zIndex: 2,
              background:
                d.ground === 'dark'
                  ? 'linear-gradient(104deg,rgba(255,255,255,.13) 0%,rgba(255,255,255,.04) 26%,transparent 44%,transparent 68%,rgba(255,255,255,.05) 100%)'
                  : 'linear-gradient(100deg,rgba(255,255,255,.55) 0%,rgba(255,255,255,.16) 22%,transparent 40%,transparent 72%,rgba(255,255,255,.3) 100%)',
            }}
          />

          {body}
        </div>
      </div>
    </div>
  );
}
