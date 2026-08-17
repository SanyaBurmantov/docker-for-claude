import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Model answers come back as markdown — `**bold**`, lists, fenced code — so they are
 * rendered rather than shown raw. Used by every chat drawer; styling lives in
 * `.md-body` so all of them look the same.
 *
 * Half-written markdown is normal here: the text arrives by stream, so an unclosed
 * fence just renders as the code block it is about to become.
 */
export default function Markdown({ text }: { text: string }) {
  return (
    <div className="md-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  )
}
