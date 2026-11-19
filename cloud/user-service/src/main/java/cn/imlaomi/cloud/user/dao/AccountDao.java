package cn.imlaomi.cloud.user.dao;

import cn.imlaomi.cloud.user.entity.AccountEntity;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/** 只声明账号表访问；SQL 位于 mapper/AccountDao.xml。 */
@Mapper
public interface AccountDao {
    /** 按统一大小写的账号键取得登录凭据。 */
    AccountEntity findByUsernameKey(@Param("key") String key);
    /** 稳定排序列出账号，由业务层转换为公开资料。 */
    List<AccountEntity> findAll();
    /** 判断鉴权账号是否仍存在。 */
    int countById(@Param("id") String id);
    /** 新建账号，由数据库唯一约束防止重复注册。 */
    int insert(AccountEntity account);
    /** 更新昵称，null 表示清除昵称。 */
    int updateNickname(@Param("id") String id, @Param("nickname") String nickname);
}
