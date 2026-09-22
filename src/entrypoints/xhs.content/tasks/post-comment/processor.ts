import { TaskProcessor } from "@/utils/task";
import lodash from "lodash";
const { unionBy } = lodash;
import { FormSchema } from ".";
import { getCommentPage, getCommentSubPage } from "../../api/comment";
import { limitNested, nestedCount, normalizeLimit } from "@/utils/comment-limit";
import { getCommentMedias } from "../../utils/media";
import { ParsePostUrlResult } from "../../utils/parse-url";

export class Processor extends TaskProcessor<FormSchema> {
    public mediaOptions = [{
        value: "image",
        label: "评论图片"
    }];

    async execute() {
        const { urls } = this.condition;
        const limitPerId = normalizeLimit(this.condition.limitPerId);
        let total = urls.length * limitPerId;
        this.actions.setTotal(total);
        let completed = 0;
        for (const postParam of urls) {
            const comments = await this.getNoteComments(postParam, limitPerId, completed);
            const count = this.getCommentCount(comments);
            total += count - limitPerId;
            completed += count;
            this.actions.setCompleted(completed);
            this.actions.setTotal(total);
        }
        const count = this.getCommentCount(this.getCrawledComments());
        this.actions.setCompleted(count);
        this.actions.setTotal(count);
    }

    getDataDownloadOption(): TaskDownloadOption {
        const { urls } = this.condition;
        const dataList = [[
            '评论ID',
            '笔记ID',
            '笔记链接',

            '用户ID',
            '用户链接',
            '用户名称',

            '评论内容',
            '评论时间',
            '点赞数',
            '子评论数',
            'IP地址',
            '一级评论ID',
        ]];
        const getRow = (comment: XhsAPI.Comment | XhsAPI.SubComment, url: ParsePostUrlResult, rootCommentId?: string): Array<any> => {
            const row = [];
            row.push(comment.id);
            row.push(url.id);
            row.push(url.href);

            row.push(comment.user_info?.user_id);
            row.push(
                `https://www.xiaohongshu.com/user/profile/${comment.user_info?.user_id}`,
            );
            row.push(comment.user_info?.nickname);

            row.push(comment.content);
            row.push(comment.create_time && new Date(comment.create_time));
            row.push(comment.like_count);
            row.push(
                'sub_comment_count' in comment ? comment?.sub_comment_count : null,
            );
            row.push(comment.ip_location);
            row.push(rootCommentId);
            return row;
        };
        const allComments = this.getCrawledComments();
        for (const comment of allComments) {
            const postParam = urls.find(o => o.id === comment?.note_id);
            if (!postParam) continue;
            dataList.push(getRow(comment, postParam));
            if (comment.sub_comments?.length) {
                for (const subComment of comment.sub_comments) {
                    dataList.push(getRow(subComment, postParam, comment.id));
                }
            }
        }
        return generateExcelDownloadOption(dataList, "小红书-批量导出笔记评论");
    }

    getMediaDownloadOptions(mediaTypes: string[]) {
        const list: TaskDownloadOption[] = [];
        const allComments = this.getCrawledComments();
        for (const comment of allComments) {
            const files = getCommentMedias(comment);
            list.push(...files);
            if (comment.sub_comments?.length) {
                for (const subComment of comment.sub_comments) {
                    list.push(...getCommentMedias(subComment));
                }
            }
        }
        return list;
    }

    /**
     * 获取笔记的评论
     * @param noteId 笔记ID
     * @param limit 条数限制
     */
    async getNoteComments(
        postParam: ParsePostUrlResult,
        limit: number,
        completed: number = 0,
    ): Promise<XhsAPI.Comment[]> {
        const max = normalizeLimit(limit);
        if (max <= 0) {
            this.actions.setCompleted(completed);
            return [];
        }
        let cursor = '';
        const seenCursors = new Set<string>();
        const commentList: XhsAPI.Comment[] = [];
        // 获取一级评论
        while (true) {
            const cursorKey = String(cursor);
            if (seenCursors.has(cursorKey)) break;
            seenCursors.add(cursorKey);
            const commentPage = await this.next({
                func: getCommentPage,
                args: [{
                    note_id: postParam.id,
                    xsec_token: postParam.token,
                    cursor: cursor,
                    top_comment_id: '',
                    image_formats: 'jpg,webp,avif',
                }],
                key: `${postParam.id}:${cursor}`
            });
            if (!commentPage.comments?.length) break;
            // 增加评论数
            commentList.push(...commentPage.comments);
            cursor = commentPage.cursor;
            // 更新进度
            const limited = this.limitComments(commentList, max);
            const count = this.getCommentCount(limited);
            this.actions.setCompleted(completed + count);
            if (count >= max) {
                // 已经够了
                return limited;
            }
            if (!commentPage.has_more) {
                // 没有更多评论了
                break;
            }
        }
        // 一级评论不够，获取子评论
        const hasMoreSubComments = commentList.filter((item) => item.sub_comment_has_more);
        for (const comment of hasMoreSubComments) {
            const countBeforeReplies = this.getCommentCount(this.limitComments(commentList, max));
            if (countBeforeReplies >= max) break;
            this.actions.setCompleted(completed + countBeforeReplies);
            const existingSubComments = comment.sub_comments || [];
            const subComments = await this.getNoteSubComments(
                postParam,
                comment.id,
                comment.sub_comment_cursor,
                max - countBeforeReplies,
                existingSubComments,
            );
            comment.sub_comments = unionBy(existingSubComments.concat(subComments), 'id');
            const limited = this.limitComments(commentList, max);
            const count = this.getCommentCount(limited);
            this.actions.setCompleted(completed + count);
            if (count >= max) {
                // 已经够了
                return limited;
            }
        }
        return this.limitComments(commentList, max);
    }

    /**
     * 获取笔记的子评论
     * @param postParam 笔记参数
     * @param rootCommentId 根评论ID
     * @param cursor 游标
     * @param limit 条数限制
     */
    async getNoteSubComments(
        postParam: ParsePostUrlResult,
        rootCommentId: string,
        cursor: string,
        limit: number,
        existingSubComments: readonly XhsAPI.SubComment[] = [],
    ): Promise<XhsAPI.SubComment[]> {
        const max = normalizeLimit(limit);
        if (max <= 0) return [];
        const subCommentList: XhsAPI.SubComment[] = [];
        const knownSubCommentIds = new Set(existingSubComments.map(subComment => subComment.id));
        const seenCursors = new Set<string>();
        while (true) {
            const cursorKey = String(cursor);
            if (seenCursors.has(cursorKey)) break;
            seenCursors.add(cursorKey);
            const commentPage = await this.next({
                func: getCommentSubPage,
                args: [{
                    note_id: postParam.id,
                    xsec_token: postParam.token,
                    root_comment_id: rootCommentId,
                    num: Math.min(10, max),
                    cursor: cursor,
                    image_formats: 'jpg,webp,avif',
                    top_comment_id: '',
                }],
                key: `${postParam.id}:${rootCommentId}:${cursor}`
            });
            if (!commentPage.comments?.length) break;
            for (const subComment of commentPage.comments) {
                if (knownSubCommentIds.has(subComment.id)) continue;
                knownSubCommentIds.add(subComment.id);
                subCommentList.push(subComment);
                if (subCommentList.length >= max) break;
            }
            if (subCommentList.length >= max || !commentPage.has_more) break;
            cursor = commentPage.cursor;
        }
        return subCommentList;
    }

    getCommentCount = (comments: XhsAPI.Comment[]): number => {
        return nestedCount(comments, (comment) => comment.sub_comments);
    };

    getCrawledComments() {
        const allComments: XhsAPI.Comment[] = [];
        for (const url of this.condition.urls) {
            const keys = this.commentCacheKeys(url.id);
            const rootComments: XhsAPI.Comment[] = [];
            const subComments = new Map<string, XhsAPI.SubComment[]>();
            for (const key of keys) {
                const comments = this.dataCache.get(key)?.comments;
                if (!comments) continue;
                const nodes = key.split(':');
                if (nodes.length === 3) {
                    const current = subComments.get(nodes[1]) || [];
                    subComments.set(nodes[1], unionBy(current.concat(comments as XhsAPI.SubComment[]), 'id'));
                } else {
                    rootComments.push(...comments as XhsAPI.Comment[]);
                }
            }
            const comments = unionBy(rootComments, 'id').map(comment => ({
                ...comment,
                sub_comments: unionBy(
                    (comment.sub_comments || []).concat(subComments.get(comment.id) || []),
                    'id',
                ),
            }));
            const limited = this.limitComments(comments, this.condition.limitPerId);
            allComments.push(...limited);
        }
        return unionBy(allComments, 'id');
    }

    private limitComments(comments: XhsAPI.Comment[], limit: number): XhsAPI.Comment[] {
        return limitNested(
            comments,
            limit,
            comment => comment.sub_comments,
            (comment, subComments) => ({ ...comment, sub_comments: subComments }),
        );
    }

    private commentCacheKeys(noteId: string): string[] {
        const prefix = `${noteId}:`;
        return Array.from(this.dataCache.keys()).filter(key => key.startsWith(prefix));
    }
}
