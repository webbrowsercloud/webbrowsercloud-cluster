/**
 * 验证处理用户传入的 url 参数，删除用户传入的 token、use-data-dir 等
 * @param urlSearch 只有 url 的 search 部分
 * @returns 返回处理过的 url
 */
export function verifyWsEndpointParams(
  urlSearch: string,
  workerToken: string,
): string {
  const newUrl = new URL(`https://localhost${urlSearch}`);

  // 处理 token
  newUrl.searchParams.set('token', workerToken);

  // 删除用户传入的 --user-data-dir
  newUrl.searchParams.delete('--user-data-dir');

  const useDataId = newUrl.searchParams.get('--user-data-id');

  if (useDataId) {
    if (!new RegExp(/^[a-z0-9-]+$/).test(useDataId)) {
      throw new Error('Invalid user data id');
    }

    newUrl.searchParams.set(
      '--user-data-dir',
      `/usr/src/app/userdata/temp/${useDataId}`,
    );
  }

  return newUrl.search;
}
