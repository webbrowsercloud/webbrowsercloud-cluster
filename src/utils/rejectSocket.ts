import { Socket } from 'net';

export interface RejectSocketProps {
  socket: Socket;
  header: string;
  message: string;
}

const dedent = (strings: string | string[], ...values: string[]) => {
  const raw = Array.isArray(strings) ? strings : [strings];

  let result = '';

  for (let i = 0; i < raw.length; i++) {
    result += raw[i]
      // join lines when there is a suppressed newline
      .replace(/\\\n[ \t]*/g, '')
      // handle escaped backticks
      .replace(/\\`/g, '`');

    if (i < values.length) {
      result += values[i];
    }
  }

  // now strip indentation
  const lines = result.split('\n');
  let mIndent: number | null = null;
  lines.forEach((l) => {
    const m = l.match(/^(\s+)\S+/);
    if (m) {
      const indent = m[1].length;
      if (!mIndent) {
        // this is the first indented line
        mIndent = indent;
      } else {
        mIndent = Math.min(mIndent, indent);
      }
    }
  });

  if (mIndent !== null) {
    const m = mIndent;
    result = lines.map((l) => (l[0] === ' ' ? l.slice(m) : l)).join('\n');
  }

  return (
    result
      // dedent eats leading and trailing whitespace too
      .trim()
      // handle escaped newlines at the end to ensure they don't get stripped too
      .replace(/\\n/g, '\n')
  );
};

export const rejectSocket = ({
  socket,
  header,
  message,
}: RejectSocketProps) => {
  const httpResponse = dedent(`${header}
      Content-Type: text/plain; charset=UTF-8
      Content-Encoding: UTF-8
      Accept-Ranges: bytes
      Connection: keep-alive

      ${message}`);

  socket.write(httpResponse);

  socket.end();

  socket.destroy();
};
