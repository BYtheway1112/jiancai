import { TaskProcessor } from "@/utils/task";
import { unionBy } from "lodash";
import { FormSchema } from ".";
import * as http from "../../api";
import { limitNested, nestedCount, normalizeLimit } from "@/utils/comment-limit";
import { getCommentMedias } from "../../utils/media";

export class Processor extends TaskProcessor<FormSchema, DouyinAPI.AwemeV1WebComment | DouyinAPI.AwemeV1WebCommentReply> {
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
        for (const url of urls) {
            const comments = await this.getAwemeComments(url.id, limitPerId, completed);
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
        const dataList: any[][] = [[
            '评论ID',
            '视频ID',
            '视频链接',

            '用户UID',
            '用户链接',
            '抖音号',
            '用户名称',

            '评论内容',
            '评论时间',
            '点赞数',
            '子评论数',
            'IP地址',
            '一级评论ID',
        ]];
        const getRow = (comment: DouyinAPI.Comment | DouyinAPI.ReplyComment): Array<any> => {
            const row = [];
            row.push(comment.cid);
            row.push(comment.aweme_id);
            row.push(`https://www.douyin.com/video/${comment.aweme_id}`);

            row.push(comment.user?.uid);
            row.push(`https://www.douyin.com/user/${comment.user?.sec_uid}`);
            row.push(comment.user?.unique_id || comment.user?.short_id);
            row.push(comment.user?.nickname);

            row.push(comment.text);
            row.push(comment.create_time && new Date(comment.create_time * 1000));
            row.push(comment.digg_count);
            row.push(
                'reply_comment_total' in comment ? comment?.reply_comment_total : '-',
            );
            row.push(comment.ip_label);

            row.push(comment.reply_id != '0' ? comment.reply_id : '-');
            return row;
        };
        const allComments = this.getCrawledComments();
        for (const comment of allComments) {
            dataList.push(getRow(comment));
            if (comment.reply_comment?.length) {
                for (const subComment of comment.reply_comment) {
                    dataList.push(getRow(subComment));
                }
            }
        }
        return generateExcelDownloadOption(dataList, "抖音-批量导出视频评论");
    }

    getMediaDownloadOptions(mediaTypes: string[]) {
        const list: TaskDownloadOption[] = [];
        const allComments = this.getCrawledComments();
        for (const comment of allComments) {
            const files = getCommentMedias(comment);
            list.push(...files);
            if (comment.reply_comment?.length) {
                for (const subComment of comment.reply_comment) {
                    list.push(...getCommentMedias(subComment));
                }
            }
        }
        return list;
    }


    /**
     * 获取视频的评论
     * @param task 连接信息
     * @param awemeId 视频ID
     * @param limit 条数限制
     * @param completed 已抓取的数量
     */
    async getAwemeComments(
        awemeId: string,
        limit: number,
        completed: number = 0,
    ): Promise<DouyinAPI.Comment[]> {
        const max = normalizeLimit(limit);
        if (max <= 0) {
            this.actions.setCompleted(completed);
            return [];
        }
        let cursor = 0;
        const seenCursors = new Set<string>();
        const commentList: DouyinAPI.Comment[] = [];
        // 获取一级评论
        while (true) {
            const cursorKey = String(cursor);
            if (seenCursors.has(cursorKey)) break;
            seenCursors.add(cursorKey);
            const commentPage = await this.next(
                {
                    key: `${awemeId}:${cursor}`,
                    func: http.comment.getCommentList,
                    args: [{
                        aweme_id: awemeId,
                        cursor: cursor,
                        count: Math.min(20, max),
                        item_type: 0,
                    }]
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
        const hasReplies = commentList.filter(
            (item) => item.reply_comment_total > 0,
        );
        for (const comment of hasReplies) {
            const countBeforeReplies = this.getCommentCount(this.limitComments(commentList, max));
            if (countBeforeReplies >= max) break;
            this.actions.setCompleted(completed + countBeforeReplies);
            const existingReplies = comment.reply_comment || [];
            const replies = await this.getCommentReplies(
                awemeId,
                comment.cid,
                max - countBeforeReplies,
                existingReplies,
            );
            comment.reply_comment = unionBy(existingReplies.concat(replies), 'cid');
            // 更新进度
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
     * 获取视频评论的子评论
     * @param client 连接信息
     * @param awemeId 视频ID
     * @param commentId 根评论ID
     * @param limit 条数限制
     */
    async getCommentReplies(
        awemeId: string,
        commentId: string,
        limit: number,
        existingReplies: readonly DouyinAPI.ReplyComment[] = [],
    ): Promise<DouyinAPI.ReplyComment[]> {
        const max = normalizeLimit(limit);
        if (max <= 0) return [];
        let cursor = 0;
        const seenCursors = new Set<string>();
        const commentReplies: DouyinAPI.ReplyComment[] = [];
        const knownReplyIds = new Set(existingReplies.map(reply => reply.cid));
        while (true) {
            const cursorKey = String(cursor);
            if (seenCursors.has(cursorKey)) break;
            seenCursors.add(cursorKey);
            const commentPage = await this.next({
                key: `${awemeId}:${commentId}:${cursor}`,
                func: http.comment.getCommentReplyList,
                args: [{
                    item_id: awemeId,
                    comment_id: commentId,
                    cursor: cursor,
                    count: Math.min(20, max),
                    item_type: 0,
                }]
            });
            if (!commentPage.comments?.length) break;
            for (const reply of commentPage.comments) {
                if (knownReplyIds.has(reply.cid)) continue;
                knownReplyIds.add(reply.cid);
                commentReplies.push(reply);
                if (commentReplies.length >= max) break;
            }
            if (commentReplies.length >= max) {
                // 足够了
                break;
            }
            if (!commentPage.has_more) {
                // 没有更多评论了
                break;
            }
            cursor = commentPage.cursor;
        }
        return commentReplies;
    }

    getCommentCount = (comments: DouyinAPI.Comment[]): number => {
        return nestedCount(comments, (comment) => comment.reply_comment);
    };

    getCrawledComments() {
        const allComments: DouyinAPI.Comment[] = [];
        for (const url of this.condition.urls) {
            const keys = this.commentCacheKeys(url.id);
            const rootComments: DouyinAPI.Comment[] = [];
            const replies = new Map<string, DouyinAPI.ReplyComment[]>();
            for (const key of keys) {
                const comments = this.dataCache.get(key)?.comments;
                if (!comments) continue;
                const nodes = key.split(':');
                if (nodes.length === 3) {
                    const current = replies.get(nodes[1]) || [];
                    replies.set(nodes[1], unionBy(current.concat(comments as DouyinAPI.ReplyComment[]), 'cid'));
                } else {
                    rootComments.push(...comments as DouyinAPI.Comment[]);
                }
            }
            const comments = unionBy(rootComments, 'cid').map(comment => ({
                ...comment,
                reply_comment: unionBy(
                    (comment.reply_comment || []).concat(replies.get(comment.cid) || []),
                    'cid',
                ),
            }));
            const limited = this.limitComments(comments, this.condition.limitPerId);
            allComments.push(...limited);
        }
        return unionBy(allComments, 'cid');
    }

    private limitComments(comments: DouyinAPI.Comment[], limit: number): DouyinAPI.Comment[] {
        return limitNested(
            comments,
            limit,
            comment => comment.reply_comment,
            (comment, replies) => ({ ...comment, reply_comment: replies }),
        );
    }

    private commentCacheKeys(awemeId: string): string[] {
        const prefix = `${awemeId}:`;
        return Array.from(this.dataCache.keys()).filter(key => key.startsWith(prefix));
    }
}
