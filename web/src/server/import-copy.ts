import { shellQuote } from "@/server/ssh/connection";

/** A bounded, no-follow copy. Limits are checked while reading, not just before the copy. */
const COPY_TREE = `import os, stat, sys
src, dst, base = sys.argv[1:4]
limit, reserve = map(int, sys.argv[4:6])
used = 0
entries = 0
flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
def directory(path):
    if not path.startswith('/') or any(p in ('.', '..') for p in path.split('/')):
        raise RuntimeError('Invalid copy path')
    fd = os.open('/', flags)
    try:
        for part in path.split('/'):
            if part:
                child = os.open(part, flags, dir_fd=fd)
                os.close(fd)
                fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise
basefd = directory(base)
def room(extra):
    free = os.fstatvfs(basefd)
    if free.f_bavail * free.f_frsize < reserve + extra:
        raise RuntimeError('Copy stopped to preserve free disk space')
def names(fd):
    with os.scandir(fd) as listing:
        for entry in listing:
            yield entry.name
def copy_tree(source, target):
    global used, entries
    for name in names(source):
        entries += 1
        if entries > 200000:
            raise RuntimeError('Too many entries in preview release')
        info = os.stat(name, dir_fd=source, follow_symlinks=False)
        room(65536)
        if stat.S_ISLNK(info.st_mode):
            os.symlink(os.readlink(name, dir_fd=source), name, dir_fd=target)
        elif stat.S_ISDIR(info.st_mode):
            os.mkdir(name, mode=0o700, dir_fd=target)
            s = os.open(name, flags, dir_fd=source)
            try:
                t = os.open(name, flags, dir_fd=target)
                try:
                    copy_tree(s, t)
                    os.fchmod(t, stat.S_IMODE(info.st_mode) & 0o777)
                finally:
                    os.close(t)
            finally:
                os.close(s)
        elif stat.S_ISREG(info.st_mode):
            s = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=source)
            try:
                actual = os.fstat(s)
                if not stat.S_ISREG(actual.st_mode) or actual.st_size > limit - used:
                    raise RuntimeError('Preview exceeds copy byte budget')
                t = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=target)
                try:
                    while True:
                        data = os.read(s, 65536)
                        if not data:
                            break
                        if len(data) > limit - used:
                            raise RuntimeError('Preview grew beyond copy byte budget')
                        room(len(data) + 65536)
                        pending = memoryview(data)
                        while pending:
                            written = os.write(t, pending)
                            if written <= 0:
                                raise RuntimeError('Copy write failed')
                            pending = pending[written:]
                        used += len(data)
                    os.fchmod(t, stat.S_IMODE(actual.st_mode) & 0o777)
                    os.utime(t, ns=(actual.st_atime_ns, actual.st_mtime_ns))
                finally:
                    os.close(t)
            finally:
                os.close(s)
        else:
            raise RuntimeError('Preview contains unsupported special files')
if not src.startswith(base + '/releases/') or not dst.startswith(base + '/releases/'):
    raise RuntimeError('Copy is outside the project releases')
s = directory(src)
p = directory(os.path.dirname(dst))
try:
    room(65536)
    os.mkdir(os.path.basename(dst), mode=0o700, dir_fd=p)
    t = os.open(os.path.basename(dst), flags, dir_fd=p)
    try:
        copy_tree(s, t)
    finally:
        os.close(t)
finally:
    os.close(s)
    os.close(p)
    os.close(basefd)
`;

export function boundedImportCopy(src: string, dst: string, base: string, maxBytes: number, reserveBytes: number): string {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(reserveBytes) || reserveBytes < 0) {
    throw new Error("Invalid import copy budget");
  }
  return `timeout --kill-after=5 100 python3 -c ${shellQuote(COPY_TREE)} ${shellQuote(src)} ${shellQuote(dst)} ${shellQuote(base)} ${maxBytes} ${reserveBytes}\n`;
}
